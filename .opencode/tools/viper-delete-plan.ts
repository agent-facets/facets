import { access, rm } from 'node:fs/promises'
import path from 'node:path'
import { tool } from '@opencode-ai/plugin'

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

export default tool({
  description: 'Delete VIPER plans',
  args: {
    plan: tool.schema.string().describe('Plan name to delete'),
  },
  async execute(args, context): Promise<string> {
    if (!SAFE_NAME.test(args.plan)) {
      return JSON.stringify({ success: false, reason: 'invalid_name', name: args.plan })
    }

    const planDir = path.join(context.worktree, '.opencode', 'plans', args.plan)

    try {
      await access(planDir)
    } catch {
      return JSON.stringify({ success: false, reason: 'not_found' })
    }

    await rm(planDir, { recursive: true, force: true })
    return JSON.stringify({ success: true, path: planDir })
  },
})
