import { commands } from './commands.ts'
import { run } from './run.ts'

try {
  const code = await run(process.argv.slice(2), commands)
  process.exit(code)
} catch (error) {
  console.error(error instanceof Error ? error.message : 'An unexpected error occurred.')
  process.exit(2)
}
