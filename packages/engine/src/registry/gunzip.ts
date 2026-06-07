import type { GunzipFn } from '@agent-facets/protocol'

/**
 * An uncapped gunzip suitable for CLI-side use of `validateFacetArchive`.
 *
 * The CLI's input to `validateFacetArchive` is `dist/*.facet`, which the
 * same user just produced by building their own source. There is no
 * trust boundary, so the gunzip does not enforce a maximum-decompressed
 * size cap — a "bomb" here would be the user's own file on their own
 * machine. The registry, which ingests untrusted uploads from arbitrary
 * publishers, supplies its own streaming + size-capped gunzip
 * elsewhere; that is not this function.
 *
 * Contract (matches `GunzipFn` from `@agent-facets/protocol`):
 *   - On valid gzip input, returns `{ ok: true; bytes }` carrying the
 *     fully inflated inner tar.
 *   - On malformed or truncated gzip input, returns `{ ok: false,
 *     reason: 'corrupt' }`. Never throws.
 *   - Never returns `{ ok: false, reason: 'too-large' }` — this gunzip
 *     does not enforce a cap, so the `too-large` arm is structurally
 *     unreachable here. Callers that need bomb defense MUST supply a
 *     different `GunzipFn` implementation.
 */
export const uncappedGunzip: GunzipFn = async (innerGzBytes) => {
  try {
    // Bun.gunzipSync types its input as `Uint8Array<ArrayBuffer>` (the
    // stricter subtype) while protocol passes us the looser
    // `Uint8Array<ArrayBufferLike>`. Create a view over the same bytes
    // (no copy) at the boundary.
    const view = new Uint8Array(innerGzBytes.buffer, innerGzBytes.byteOffset, innerGzBytes.byteLength)
    // @ts-expect-error: bun expects the stricter type, but doesn't make use of it...this error is fine
    // and a well tested boundary
    const bytes = Bun.gunzipSync(view)
    return { ok: true, bytes }
  } catch {
    return { ok: false, reason: 'corrupt' }
  }
}
