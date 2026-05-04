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

  const content = await file.text()
  return { ok: true, content }
}
