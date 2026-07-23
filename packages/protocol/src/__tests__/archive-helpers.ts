import {
  type ArchiveEntry,
  assembleOuterTar,
  assembleTar,
  collectArchiveEntries,
  computeAssetHashes,
  computeContentHash,
  type GunzipFn,
  INNER_ARCHIVE_NAME,
  type ResolvedFacetManifest,
} from '@agent-facets/protocol'

/**
 * Re-wrap a Bun gzip/gunzip output (`Uint8Array<ArrayBufferLike>`) into a
 * `Uint8Array<ArrayBuffer>` so it satisfies the stricter signatures used
 * by `nanotar` and protocol's archive helpers.
 */
export const intoArrayBuffer = <B extends ArrayBufferLike>(bytes: Uint8Array<B>): Uint8Array<ArrayBuffer> =>
  new Uint8Array(bytes)

export const gz = (input: Uint8Array): Uint8Array => intoArrayBuffer(Bun.gzipSync(intoArrayBuffer(input)))

/** Trivial gunzip backed by Bun's built-in. Always succeeds for valid gzip. */
export const okGunzip: GunzipFn = async (bytes) => {
  try {
    return { ok: true, bytes: intoArrayBuffer(Bun.gunzipSync(intoArrayBuffer(bytes))) }
  } catch {
    return { ok: false, reason: 'corrupt' }
  }
}

/** Forced 'too-large' gunzip — simulates a registry-side bomb defense. */
export const tooLargeGunzip: GunzipFn = async () => ({ ok: false, reason: 'too-large' })

/** Forced 'corrupt' gunzip — simulates an inflate error. */
export const corruptGunzip: GunzipFn = async () => ({ ok: false, reason: 'corrupt' })

/**
 * Build a real legacy (`0.1`) `.facet` outer-tar from a
 * `ResolvedFacetManifest`. Mirrors what the legacy `runBuildPipeline`
 * emitted, end-to-end, but pure (no I/O).
 */
export function buildLegacyArchive(
  resolved: ResolvedFacetManifest,
  manifestJsonString = JSON.stringify(
    {
      name: resolved.name,
      version: resolved.version,
      ...(resolved.description !== undefined && { description: resolved.description }),
      ...(resolved.skills && {
        skills: Object.fromEntries(
          Object.entries(resolved.skills).map(([name, s]) => [name, { description: s.description }]),
        ),
      }),
      ...(resolved.agents && {
        agents: Object.fromEntries(
          Object.entries(resolved.agents).map(([name, a]) => [name, { description: a.description }]),
        ),
      }),
      ...(resolved.commands && {
        commands: Object.fromEntries(
          Object.entries(resolved.commands).map(([name, c]) => [name, { description: c.description }]),
        ),
      }),
    },
    null,
    2,
  ),
): { outerBytes: Uint8Array; buildManifestJson: string } {
  const entries = collectArchiveEntries(resolved, manifestJsonString)
  const assetHashes = computeAssetHashes(entries)
  const innerTar = assembleTar(entries)
  const integrity = computeContentHash(innerTar)
  const buildManifest = {
    facetVersion: 0.1,
    archive: INNER_ARCHIVE_NAME,
    integrity,
    assets: assetHashes,
  }
  const buildManifestJson = JSON.stringify(buildManifest, null, 2)
  const outerBytes = assembleOuterTar(buildManifestJson, gz(innerTar))
  return { outerBytes, buildManifestJson }
}

/**
 * Build a current (`0.2`) `.facet` outer-tar from a complete inner entry
 * map (including `facet.json`). No producer emits `0.2` yet, so tests and
 * the fixture generator construct current archives with this helper —
 * canonical serialization (sorted entries, deterministic attrs), all-entry
 * `files` hash map, exact `facetVersion: 0.2`.
 *
 * `mutate` lets tampering tests adjust the build manifest before assembly.
 */
export function buildCurrentArchive(
  inner: Record<string, string | Uint8Array>,
  mutate?: (buildManifest: {
    facetVersion: number
    archive: string
    integrity: string
    files: Record<string, string>
  }) => Record<string, unknown>,
): { outerBytes: Uint8Array; buildManifestJson: string; innerTar: Uint8Array } {
  const entries: ArchiveEntry[] = Object.entries(inner).map(([path, content]) => ({ path, content }))
  entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  const files: Record<string, string> = {}
  for (const entry of entries) {
    files[entry.path] = computeContentHash(entry.content)
  }
  const innerTar = assembleTar(entries)
  const integrity = computeContentHash(innerTar)
  const buildManifest = { facetVersion: 0.2, archive: INNER_ARCHIVE_NAME, integrity, files }
  const finalManifest = mutate ? mutate(buildManifest) : buildManifest
  const buildManifestJson = JSON.stringify(finalManifest, null, 2)
  const outerBytes = assembleOuterTar(buildManifestJson, gz(innerTar))
  return { outerBytes, buildManifestJson, innerTar }
}

// --- Raw tar construction for header-level attack fixtures ---

export interface RawTarEntrySpec {
  name: string
  content?: string
  /** Tar typeflag character; defaults to '0' (regular file). */
  typeflag?: string
  /** ustar prefix field contents (canonical archives never use it). */
  prefix?: string
}

function rawTarHeader(name: string, size: number, typeflag: string, prefix: string): Uint8Array {
  const block = new Uint8Array(512)
  const enc = new TextEncoder()
  block.set(enc.encode(name).subarray(0, 100), 0)
  block.set(enc.encode('0000644\0'), 100)
  block.set(enc.encode('0000000\0'), 108)
  block.set(enc.encode('0000000\0'), 116)
  block.set(enc.encode(`${size.toString(8).padStart(11, '0')}\0`), 124)
  block.set(enc.encode('00000000000\0'), 136)
  block.set(enc.encode('        '), 148)
  block[156] = typeflag.charCodeAt(0)
  block.set(enc.encode('ustar\0'), 257)
  block.set(enc.encode('00'), 263)
  if (prefix !== '') {
    block.set(enc.encode(prefix).subarray(0, 155), 345)
  }
  let sum = 0
  for (const byte of block) sum += byte
  block.set(enc.encode(`${sum.toString(8).padStart(6, '0')}\0 `), 148)
  return block
}

/**
 * Hand-assemble raw tar bytes so tests can craft header-level attacks that
 * `createTar` refuses to produce: duplicate paths, non-regular typeflags,
 * PAX/GNU header entries, ustar prefixes, and post-terminator garbage.
 */
export function buildRawTar(
  entries: RawTarEntrySpec[],
  opts?: { trailing?: Uint8Array; noTerminator?: boolean },
): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  for (const entry of entries) {
    const data = enc.encode(entry.content ?? '')
    chunks.push(rawTarHeader(entry.name, data.length, entry.typeflag ?? '0', entry.prefix ?? ''))
    if (data.length > 0) {
      const padded = new Uint8Array(Math.ceil(data.length / 512) * 512)
      padded.set(data)
      chunks.push(padded)
    }
  }
  if (!opts?.noTerminator) {
    chunks.push(new Uint8Array(1024))
  }
  if (opts?.trailing) {
    chunks.push(opts.trailing)
  }
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}
