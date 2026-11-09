import { stat } from 'node:fs/promises'
import type { ValidationError } from '@agent-facets/common'

/**
 * Reads a file from disk. Returns the text content or a ValidationError array.
 *
 * Engine-side helper — uses Bun's file API. Protocol-side validators take
 * bytes directly; engine reads bytes from disk and passes them along.
 */
export async function readFile(
  filePath: string,
): Promise<{ ok: true; content: string } | { ok: false; errors: ValidationError[] }> {
  const file = Bun.file(filePath)
  const exists = await file.exists()
  if (!exists) {
    return {
      ok: false,
      errors: [
        {
          path: '',
          message: `File not found: ${filePath}`,
          expected: 'file to exist',
          actual: 'file not found',
        },
      ],
    }
  }

  // Only a regular file is read. A FIFO or device at this path would block
  // `file.text()` with no writer, hanging the command; a directory has no text.
  const info = await stat(filePath).catch(() => undefined)
  if (info === undefined || !info.isFile()) {
    return {
      ok: false,
      errors: [
        {
          path: '',
          message: `Not a regular file: ${filePath}`,
          expected: 'a regular file',
          actual: info === undefined ? 'unreadable' : 'another kind of file',
        },
      ],
    }
  }

  const content = await file.text()
  return { ok: true, content }
}
