import path from 'node:path'
import { tool } from '@opencode-ai/plugin'

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

export default tool({
  description: 'Read VIPER plan artifacts',
  args: {
    plan: tool.schema.string().describe('Plan name to read'),
    artifact: tool.schema.string().optional().describe('Artifact name (defaults to "plan")'),
  },
  async execute(args, context): Promise<string> {
    if (!SAFE_NAME.test(args.plan)) {
      return JSON.stringify({ success: false, reason: 'invalid_name', name: args.plan })
    }

    const artifact = args.artifact ?? 'plan'
    if (!SAFE_NAME.test(artifact)) {
      return JSON.stringify({ success: false, reason: 'invalid_artifact', artifact })
    }

    const filePath = path.join(context.worktree, '.opencode', 'plans', args.plan, `${artifact}.md`)

    try {
      const content = await Bun.file(filePath).text()
      return JSON.stringify({ content, plan: args.plan, artifact })
    } catch {
      return JSON.stringify({ success: false, reason: 'not_found', plan: args.plan, artifact })
    }
  },
})
