import type { ValidationError } from '@agent-facets/common'
import { portableCollisionKey } from './archive-plan.ts'

/**
 * Strict raw tar-header validation (design D5).
 *
 * nanotar's `parseTar` is a *lenient* extractor: it sanitizes traversal
 * paths instead of rejecting them, interprets PAX/GNU header entries that
 * can rename the following entry, ignores the ustar `prefix` field, and
 * stops parsing at the first zero block. All of that is fine for reading
 * honest archives and disastrous at a trust boundary, where lenient
 * parsing lets two implementations see different files in one byte
 * sequence.
 *
 * This module walks the raw 512-byte header blocks itself — no data
 * extraction, no sanitization, no header interpretation — and REJECTS
 * anything a canonical facet tar (produced by `assembleTar` /
 * `assembleOuterTar`) can never contain. After this validation accepts a
 * buffer, nanotar's extraction is guaranteed to agree with the validated
 * entry list, because every input that could make it disagree has been
 * rejected.
 *
 * Applied to BOTH archive layers (the outer `.facet` container and the
 * uncompressed inner tar) before any path-keyed selection.
 */

/** Distinct failure classes for raw tar-header validation. */
export type RawTarErrorCode =
  /** Entry typeflag is not a regular file (symlink, hardlink, directory, device, FIFO, PAX/GNU header, unknown). */
  | 'tar-non-regular-entry'
  /** The ustar `prefix` field is non-empty (canonical facet tars never split paths). */
  | 'tar-ustar-prefix'
  /** The raw entry name is not already canonical (absolute, traversal, empty/`.` segment, backslash). */
  | 'tar-non-canonical-path'
  /** Two entries share the exact same raw path. */
  | 'tar-duplicate-path'
  /** Two entries collide by Unicode normalization or portable case folding. */
  | 'tar-alias-path'
  /** Entries are not in canonical (ascending byte-wise) path order. */
  | 'tar-non-canonical-order'
  /** Non-zero bytes appear after the end-of-archive marker. */
  | 'tar-trailing-data'
  /** The buffer is truncated or a header is structurally malformed. */
  | 'tar-malformed'

/** A structured raw-header failure with a machine-readable failure class. */
export interface RawTarError extends ValidationError {
  code: RawTarErrorCode
}

/** One raw entry accepted by header validation. */
export interface RawTarEntry {
  /** The exact raw path bytes, decoded as UTF-8. Guaranteed canonical. */
  path: string
}

export type RawTarValidationResult = { ok: true; entries: RawTarEntry[] } | { ok: false; errors: RawTarError[] }

const BLOCK_SIZE = 512
const NAME_OFFSET = 0
const NAME_LENGTH = 100
const CHECKSUM_OFFSET = 148
const CHECKSUM_LENGTH = 8
const SIZE_OFFSET = 124
const SIZE_LENGTH = 12
const TYPEFLAG_OFFSET = 156
const PREFIX_OFFSET = 345
const PREFIX_LENGTH = 155

/** Human-readable labels for known tar typeflags, for error messages. */
const TYPEFLAG_LABELS: Record<string, string> = {
  '1': 'hard link',
  '2': 'symbolic link',
  '3': 'character device',
  '4': 'block device',
  '5': 'directory',
  '6': 'FIFO',
  '7': 'contiguous file',
  x: 'PAX extended header',
  g: 'PAX global header',
  L: 'GNU long file name',
  K: 'GNU long link name',
  N: 'GNU old long file name',
}

function isZeroBlock(bytes: Uint8Array, offset: number): boolean {
  for (let i = offset; i < offset + BLOCK_SIZE; i++) {
    if (bytes[i] !== 0) return false
  }
  return true
}

/**
 * Reads a NUL-terminated field, decoding the bytes as UTF-8 *fatally*:
 * invalid byte sequences return `undefined` rather than being silently
 * replaced with U+FFFD. A lenient decode would let a crafted header whose
 * raw name is `files/\xff.bin` be accepted as `files/�.bin`, which the
 * embedded manifest and the cache-recompute path would then treat as a
 * different byte sequence than what was actually stored — a hash-divergence
 * and path-smuggling vector. Rejecting non-round-trippable names closes it.
 */
function readFieldFatal(bytes: Uint8Array, offset: number, length: number): string | undefined {
  let end = offset
  const max = offset + length
  while (end < max && bytes[end] !== 0) end++
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, end))
  } catch {
    return undefined
  }
}

/**
 * Verify the ustar header checksum for the 512-byte block at `offset`.
 *
 * The checksum is the unsigned sum of every header byte, with the 8-byte
 * checksum field itself treated as ASCII spaces. It is the tar format's own
 * structural integrity check; a header whose name/size/payload are intact but
 * whose checksum was corrupted is malformed, and accepting it means a
 * conforming tar consumer downstream may reject an archive this validator
 * blessed. Canonical builders write the checksum as up-to-6 octal digits, a
 * NUL, then a space; we accept any all-octal field value.
 */
function verifyChecksum(bytes: Uint8Array, offset: number): boolean {
  const raw = readField(bytes, offset + CHECKSUM_OFFSET, CHECKSUM_LENGTH).trim()
  if (raw === '' || !/^[0-7]+$/.test(raw)) return false
  const stored = Number.parseInt(raw, 8)
  let sum = 0
  for (let i = offset; i < offset + BLOCK_SIZE; i++) {
    // The checksum field is summed as if filled with ASCII spaces (0x20).
    if (i >= offset + CHECKSUM_OFFSET && i < offset + CHECKSUM_OFFSET + CHECKSUM_LENGTH) {
      sum += 0x20
    } else {
      sum += bytes[i] ?? 0
    }
  }
  return sum === stored
}

/** Reads a NUL-terminated field as UTF-8. Returns undefined if it contains interior control bytes that make it undecodable as a path. */
function readField(bytes: Uint8Array, offset: number, length: number): string {
  let end = offset
  const max = offset + length
  while (end < max && bytes[end] !== 0) end++
  return new TextDecoder().decode(bytes.subarray(offset, end))
}

/** Parses the octal size field. Returns undefined for malformed or base-256 encodings. */
function readOctalSize(bytes: Uint8Array, offset: number): number | undefined {
  const first = bytes[offset]
  if (first !== undefined && (first & 0x80) !== 0) {
    // GNU base-256 size encoding — never produced by a canonical builder.
    return undefined
  }
  const raw = readField(bytes, offset, SIZE_LENGTH).trim()
  if (raw === '') return 0
  if (!/^[0-7]+$/.test(raw)) return undefined
  return Number.parseInt(raw, 8)
}

function rawError(code: RawTarErrorCode, path: string, message: string, expected: string, actual: string): RawTarError {
  return { code, path, message, expected, actual }
}

/** Validates one raw entry path as already canonical. Returns failure classes violated. */
function validateRawPath(path: string): { code: RawTarErrorCode; reason: string } | undefined {
  if (path === '') return { code: 'tar-non-canonical-path', reason: 'empty entry name' }
  if (path.includes('\\')) return { code: 'tar-non-canonical-path', reason: 'contains a backslash' }
  if (path.startsWith('/')) return { code: 'tar-non-canonical-path', reason: 'absolute path' }
  if (/^[A-Za-z]:/.test(path)) return { code: 'tar-non-canonical-path', reason: 'drive-prefixed path' }
  for (const segment of path.split('/')) {
    if (segment === '') return { code: 'tar-non-canonical-path', reason: 'empty path segment' }
    if (segment === '.') return { code: 'tar-non-canonical-path', reason: '"." path segment' }
    if (segment === '..') return { code: 'tar-non-canonical-path', reason: '".." path segment' }
  }
  return undefined
}

/** Options for {@link validateRawTarEntries}. */
export interface RawTarValidationOptions {
  /**
   * When true, require entries to appear in canonical ascending byte-wise
   * path order — the order the deterministic builder emits and the order
   * `computeDirIntegrity` re-derives when it rebuilds the tar to recompute
   * integrity. Enforced for the *inner* content tar so an out-of-order (but
   * otherwise hash-correct) archive cannot pass verification yet fail
   * installation when the recomputed tar hashes differently. NOT enforced
   * for the outer container, whose two fixed entries
   * (`build-manifest.json`, `archive.tar.gz`) are intentionally not in
   * lexicographic order.
   */
  readonly enforceCanonicalOrder?: boolean
}

/**
 * Walks the raw 512-byte tar headers of `tarBytes` and validates every
 * entry before any lossy path-keyed structure is built. Returns the
 * canonical entry list on success or structured failures identifying each
 * violation.
 *
 * `layer` labels errors for callers (e.g. `'<archive>'` for the outer
 * container, `'archive.tar.gz'` for the inner tar).
 */
export function validateRawTarEntries(
  tarBytes: Uint8Array,
  layer: string,
  options: RawTarValidationOptions = {},
): RawTarValidationResult {
  const errors: RawTarError[] = []
  const entries: RawTarEntry[] = []
  const byKey = new Map<string, string>()
  let previousPath: string | undefined

  let offset = 0
  while (true) {
    if (offset === tarBytes.length) {
      // Tar without an end-of-archive marker. nanotar tolerates this; a
      // canonical builder always emits the marker, but the bytes are
      // unambiguous, so accept.
      break
    }
    if (offset + BLOCK_SIZE > tarBytes.length) {
      errors.push(
        rawError(
          'tar-malformed',
          layer,
          'Tar data is truncated: a partial header block remains at the end of the buffer.',
          'complete 512-byte header blocks',
          `${tarBytes.length - offset} trailing bytes`,
        ),
      )
      break
    }
    if (isZeroBlock(tarBytes, offset)) {
      // End-of-archive marker. Everything after it must be zero padding —
      // non-zero bytes here are covered by the content hash but invisible
      // to parsers, a content-smuggling channel.
      for (let i = offset + BLOCK_SIZE; i < tarBytes.length; i++) {
        if (tarBytes[i] !== 0) {
          errors.push(
            rawError(
              'tar-trailing-data',
              layer,
              'Non-zero bytes appear after the tar end-of-archive marker.',
              'only zero padding after the end-of-archive marker',
              `non-zero byte at offset ${i}`,
            ),
          )
          break
        }
      }
      break
    }

    // Structural integrity: a corrupted header checksum means the block is
    // malformed even if its name/size/payload look intact. Reject before
    // interpreting any field, and stop scanning (offsets past a corrupt
    // header cannot be trusted).
    if (!verifyChecksum(tarBytes, offset)) {
      errors.push(
        rawError(
          'tar-malformed',
          layer,
          'Tar header checksum is missing or does not match the header bytes.',
          'a valid ustar header checksum',
          'checksum mismatch',
        ),
      )
      break
    }

    const typeflagByte = tarBytes[offset + TYPEFLAG_OFFSET] ?? 0
    const typeflag = typeflagByte === 0 ? '0' : String.fromCharCode(typeflagByte)
    const name = readFieldFatal(tarBytes, offset + NAME_OFFSET, NAME_LENGTH)
    const prefix = readFieldFatal(tarBytes, offset + PREFIX_OFFSET, PREFIX_LENGTH)
    const size = readOctalSize(tarBytes, offset + SIZE_OFFSET)

    // A name (or prefix) that is not valid UTF-8 cannot round-trip losslessly:
    // a lenient decoder would substitute U+FFFD, so the accepted path would
    // differ from the raw bytes the archive actually stores. Reject it.
    if (name === undefined || prefix === undefined) {
      errors.push(
        rawError(
          'tar-non-canonical-path',
          layer,
          'Tar entry name or prefix contains bytes that are not valid UTF-8. Entry names must round-trip losslessly.',
          'UTF-8 entry names',
          'invalid UTF-8 bytes',
        ),
      )
      // Size may still be readable; but a non-decodable header is untrusted,
      // so stop scanning rather than guess the next offset.
      break
    }

    if (size === undefined) {
      errors.push(
        rawError(
          'tar-malformed',
          layer,
          `Tar entry "${name}" has a malformed or non-octal size field.`,
          'octal size field',
          'malformed size',
        ),
      )
      // Cannot advance reliably past a malformed size; stop scanning.
      break
    }

    if (typeflag !== '0') {
      const label = TYPEFLAG_LABELS[typeflag] ?? `unknown type flag "${typeflag}"`
      errors.push(
        rawError(
          'tar-non-regular-entry',
          name || layer,
          `Tar entry "${name}" is a ${label}, not a regular file. Facet archives contain regular files only.`,
          'regular file entries only',
          label,
        ),
      )
    }

    if (prefix !== '') {
      errors.push(
        rawError(
          'tar-ustar-prefix',
          name || layer,
          `Tar entry "${name}" uses the ustar prefix field ("${prefix}"). Canonical facet tars never split paths across prefix and name.`,
          'empty ustar prefix field',
          `prefix "${prefix}"`,
        ),
      )
    }

    const pathIssue = validateRawPath(name)
    if (pathIssue) {
      errors.push(
        rawError(
          pathIssue.code,
          name || layer,
          `Tar entry name "${name}" is not canonical: ${pathIssue.reason}. Entry names are rejected, never sanitized.`,
          'canonical relative entry names',
          pathIssue.reason,
        ),
      )
    } else {
      const key = portableCollisionKey(name)
      const existing = byKey.get(key)
      if (existing !== undefined) {
        const exact = existing === name
        errors.push(
          rawError(
            exact ? 'tar-duplicate-path' : 'tar-alias-path',
            name,
            exact
              ? `Tar contains two entries named "${name}". Duplicate paths are rejected rather than letting parser collapse decide which entry wins.`
              : `Tar entries "${name}" and "${existing}" collide by Unicode normalization or case folding on supported filesystems.`,
            'unique entry paths',
            exact ? 'duplicate path' : `alias of "${existing}"`,
          ),
        )
      } else {
        // Ordering is an independent finding: record it but STILL track the
        // entry, so a later collision against this path is not masked by an
        // ordering rejection. `previousPath` advances by observed order.
        if (options.enforceCanonicalOrder && previousPath !== undefined && name < previousPath) {
          errors.push(
            rawError(
              'tar-non-canonical-order',
              name,
              `Tar entry "${name}" appears after "${previousPath}" but sorts before it. Entries must be in canonical ascending path order.`,
              'canonically ordered entries',
              `"${name}" out of order after "${previousPath}"`,
            ),
          )
        }
        byKey.set(key, name)
        entries.push({ path: name })
        previousPath = name
      }
    }

    offset += BLOCK_SIZE + Math.ceil(size / BLOCK_SIZE) * BLOCK_SIZE
    if (offset > tarBytes.length) {
      errors.push(
        rawError(
          'tar-malformed',
          layer,
          `Tar entry "${name}" declares a size that extends past the end of the buffer.`,
          'entry data within the buffer',
          'truncated entry data',
        ),
      )
      break
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors }
  }
  return { ok: true, entries }
}
