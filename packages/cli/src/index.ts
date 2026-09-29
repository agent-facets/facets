import { commands } from './commands.ts'
import { run } from './run.ts'

try {
  const code = await run(process.argv.slice(2), commands)
  // Let Bun drain piped stdout/stderr before terminating. `process.exit()`
  // can truncate large collision and consent reports in CI at the stream's
  // internal buffer boundary, dropping the final remediation lines.
  process.exitCode = code
} catch (error) {
  console.error(error instanceof Error ? error.message : 'An unexpected error occurred.')
  process.exitCode = 2
}
