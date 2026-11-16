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
  process.stdout.write(`${JSON.stringify(document, null, 2)}\n`)
  return result.exitCode ?? (result.ok ? 0 : 1)
}
