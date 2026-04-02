import { spawnSync } from 'node:child_process'
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Opens the user's preferred terminal editor with the given content.
 * Returns the edited content after the editor closes.
 *
 * This is synchronous — it blocks the event loop while the editor is open.
 * Callers must ensure the TUI is in a safe state before calling.
 *
 * Uses $VISUAL, $EDITOR, or falls back to 'vi'.
 */
export function openInEditorSync(content: string, filename = 'description.md'): string | null {
  const editor = process.env.VISUAL || process.env.EDITOR || 'vi'
  const tmpFile = join(tmpdir(), `facet-${Date.now()}-${filename}`)

  writeFileSync(tmpFile, content, 'utf-8')

  // Split editor command to support args (e.g., "code --wait")
  const [cmd, ...args] = editor.split(' ')
  if (!cmd) return null

  const result = spawnSync(cmd, [...args, tmpFile], {
    stdio: 'inherit',
  })

  if (result.status !== 0) return null

  const edited = readFileSync(tmpFile, 'utf-8')

  try {
    unlinkSync(tmpFile)
  } catch {
    // Ignore cleanup failures
  }

  return edited
}
