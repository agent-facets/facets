/**
 * Compresses tar bytes with gzip for the inner archive.
 *
 * Compression is a delivery concern — the integrity hash covers the
 * uncompressed tar bytes (computed in protocol via `computeContentHash`),
 * not the compressed output. Different gzip implementations may produce
 * different bytes; that's fine as long as gunzipping reproduces the same
 * inner tar.
 *
 * Engine-only: this is *how* the CLI compresses for delivery, not part of
 * the artifact contract. Protocol consumers decompress with whatever
 * runtime they like (`node:zlib.gunzipSync`, `pako`, etc.).
 */
export function compressArchive(tarBytes: Uint8Array): Uint8Array {
  const buffer = new ArrayBuffer(tarBytes.byteLength)
  new Uint8Array(buffer).set(tarBytes)
  return Bun.gzipSync(buffer)
}
