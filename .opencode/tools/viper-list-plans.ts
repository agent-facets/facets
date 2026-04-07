import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { tool } from '@opencode-ai/plugin'

export default tool({
  description: 'List VIPER plans and their artifacts',
  args: {},
  async execute(_args, context): Promise<string> {
    const plansDir = path.join(context.worktree, '.opencode', 'plans')

    try {
      const entries = await readdir(plansDir, { withFileTypes: true })
      const dirs = entries.filter((e) => e.isDirectory())

      const plans = await Promise.all(
        dirs.map(async (dir) => {
          const dirPath = path.join(plansDir, dir.name)
          const files = await readdir(dirPath)
          const artifacts = files.filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, ''))
          return { name: dir.name, artifacts }
        }),
      )

      return JSON.stringify({ plans })
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        return JSON.stringify({ plans: [] })
      }
      throw err
    }
  },
})
