export type ClassifiedBytes = { kind: 'text'; content: string } | { kind: 'binary'; sizeBytes: number }

/**
 * Text when the bytes decode as strict UTF-8 and contain no NUL byte;
 * binary otherwise.
 *
 * This is the registry's rule for its contents endpoint. A file must
 * classify the same whether it is read from the local cache or from
 * the registry, so the rule is not a local choice. A leading BOM is kept:
 * `facet cat` must reproduce the file byte for byte.
 */
export function classifyBytes(bytes: Uint8Array): ClassifiedBytes {
  if (bytes.includes(0)) return { kind: 'binary', sizeBytes: bytes.length }
  try {
    return { kind: 'text', content: new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  } catch {
    return { kind: 'binary', sizeBytes: bytes.length }
  }
}
