import { describe, expect, test } from 'bun:test'
import { assembleTar, validateRawTarEntries } from '@agent-facets/protocol'

/**
 * Focused coverage for the raw tar-header hardening: checksum verification
 * and fatal UTF-8 decoding of header name/prefix fields. Both close
 * hash-divergence / smuggling vectors where a header the validator accepts
 * would be extracted or recomputed differently downstream.
 */

const CHECKSUM_OFFSET = 148
const NAME_OFFSET = 0

/** A canonical single-entry tar produced by the deterministic builder. */
function canonicalTar(): Uint8Array {
  return new Uint8Array(assembleTar([{ path: 'facet.json', content: '{"name":"x","version":"1.0.0"}' }]))
}

describe('validateRawTarEntries — checksum verification', () => {
  test('accepts a canonical tar whose checksum is correct', () => {
    const result = validateRawTarEntries(canonicalTar(), '<test>')
    if (!result.ok) expect.unreachable()
    expect(result.entries.map((e) => e.path)).toEqual(['facet.json'])
  })

  test('rejects a tar whose header checksum was corrupted', () => {
    const bytes = canonicalTar()
    // Flip a data byte in the header (the size field, offset 124) without
    // fixing the checksum — a conforming tar tool would reject this.
    bytes[124] = bytes[124] === 0x30 ? 0x31 : 0x30
    const result = validateRawTarEntries(bytes, '<test>')
    if (result.ok) expect.unreachable()
    expect(result.errors.some((e) => e.code === 'tar-malformed')).toBe(true)
    expect(result.errors[0]?.message).toContain('checksum')
  })

  test('rejects a tar whose checksum field itself was mangled', () => {
    const bytes = canonicalTar()
    // Corrupt the stored checksum digits directly.
    bytes[CHECKSUM_OFFSET] = 0x39 // '9'
    bytes[CHECKSUM_OFFSET + 1] = 0x39
    const result = validateRawTarEntries(bytes, '<test>')
    if (result.ok) expect.unreachable()
    expect(result.errors.some((e) => e.code === 'tar-malformed')).toBe(true)
  })
})

describe('validateRawTarEntries — fatal UTF-8 name decoding', () => {
  test('rejects an entry name containing invalid UTF-8 bytes', () => {
    const bytes = canonicalTar()
    // Overwrite the first name byte with 0xFF (never valid in UTF-8). The
    // name field is `facet.json\0...`; 0xFF makes it non-decodable.
    bytes[NAME_OFFSET] = 0xff
    // Recompute a *matching* checksum so the failure is attributed to the
    // UTF-8 decode, not the checksum guard.
    fixChecksum(bytes, 0)
    const result = validateRawTarEntries(bytes, '<test>')
    if (result.ok) expect.unreachable()
    expect(result.errors.some((e) => e.code === 'tar-non-canonical-path')).toBe(true)
    expect(result.errors[0]?.message).toContain('UTF-8')
  })
})

describe('validateRawTarEntries — canonical order enforcement', () => {
  test('accepts entries already in ascending path order', () => {
    const tar = new Uint8Array(
      assembleTar([
        { path: 'a.md', content: '1' },
        { path: 'b.md', content: '2' },
      ]),
    )
    const result = validateRawTarEntries(tar, '<test>', { enforceCanonicalOrder: true })
    if (!result.ok) expect.unreachable()
    expect(result.entries.map((e) => e.path)).toEqual(['a.md', 'b.md'])
  })

  test('rejects out-of-order entries only when enforcement is on', () => {
    // Build a tar whose entries are deliberately NOT sorted. `assembleTar`
    // preserves the given order (it does not sort), so pass them reversed.
    const outOfOrder = new Uint8Array(
      assembleTar([
        { path: 'b.md', content: '2' },
        { path: 'a.md', content: '1' },
      ]),
    )

    // Without enforcement: accepted (ordering is not a raw-header concern by
    // default; the outer container relies on this).
    const lenient = validateRawTarEntries(outOfOrder, '<test>')
    if (!lenient.ok) expect.unreachable()

    // With enforcement: rejected with the dedicated code.
    const strict = validateRawTarEntries(outOfOrder, '<test>', { enforceCanonicalOrder: true })
    if (strict.ok) expect.unreachable()
    expect(strict.errors.some((e) => e.code === 'tar-non-canonical-order')).toBe(true)
  })
})

/** Rewrite the ustar checksum field for the block at `offset` to match its bytes. */
function fixChecksum(bytes: Uint8Array, offset: number): void {
  // Fill checksum field with spaces for the summation.
  for (let i = offset + CHECKSUM_OFFSET; i < offset + CHECKSUM_OFFSET + 8; i++) bytes[i] = 0x20
  let sum = 0
  for (let i = offset; i < offset + 512; i++) sum += bytes[i] ?? 0
  // Canonical encoding: 6 octal digits, NUL, space.
  const digits = sum.toString(8).padStart(6, '0')
  for (let i = 0; i < 6; i++) bytes[offset + CHECKSUM_OFFSET + i] = digits.charCodeAt(i)
  bytes[offset + CHECKSUM_OFFSET + 6] = 0x00
  bytes[offset + CHECKSUM_OFFSET + 7] = 0x20
}
