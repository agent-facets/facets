import { resolve } from 'node:path'

/**
 * One key for the paths a filesystem would treat as one file.
 *
 * A case-folding volume makes `.MCP.json` and `.mcp.json` the same file; a
 * case-sensitive one makes them two. Folding is the only answer that behaves
 * identically on both, and NFC normalization is what stops a decomposed
 * spelling of the same name from looking like a different one.
 *
 * Used wherever two paths must be recognized as the same target before either
 * is written — a batch refusing to hold two mutations of one file, and the
 * check that no two adapters reconcile one native document.
 */
export function canonicalPathKey(path: string): string {
  return resolve(path).normalize('NFC').toLowerCase()
}
