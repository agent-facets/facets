import { isHiddenCharacter } from './terminal-safe.ts'

export interface JsonWarning {
  code: string
  message: string
  details?: unknown
}

export interface JsonError {
  code: string
  message: string
  details?: unknown
  fix?: string
  docsUrl?: string
}

export type JsonResult =
  | { ok: true; data: unknown; warnings?: JsonWarning[]; exitCode?: number }
  | { ok: false; error: JsonError; warnings?: JsonWarning[]; exitCode?: number }

/** Write exactly one document for an invocation. */
export function writeJsonResult(command: string, result: JsonResult): number {
  const common = { schemaVersion: '3', command, ok: result.ok }
  const document = result.ok
    ? { ...common, data: result.data, warnings: result.warnings ?? [] }
    : { ...common, error: result.error, warnings: result.warnings ?? [] }
  process.stdout.write(`${serializeJsonDocument(document)}\n`)
  return result.exitCode ?? (result.ok ? 0 : 1)
}

/**
 * `JSON.stringify` with two-space indentation, and every character a
 * terminal would act on written as a `\uXXXX` escape. Strings in a document
 * routinely carry publisher or registry text; a parser gets the exact
 * string back, while a person reading the raw document sees inert text.
 * `JSON.stringify` already escapes C0 controls inside strings, and the
 * document's own layout uses only spaces and line feeds, which are kept.
 */
export function serializeJsonDocument(document: unknown): string {
  let out = ''
  for (const char of JSON.stringify(document, null, 2)) {
    if (char !== '\n' && isHiddenCharacter(char)) {
      for (let i = 0; i < char.length; i++) {
        out += `\\u${char.charCodeAt(i).toString(16).padStart(4, '0')}`
      }
    } else {
      out += char
    }
  }
  return out
}
