import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { tool } from '@opencode-ai/plugin'

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

export default tool({
  description: 'Write VIPER plan artifacts',
  args: {
    plan: tool.schema.string().describe('Plan name (alphanumeric, hyphens, underscores only)'),
    artifact: tool.schema.string().optional().describe('Artifact name (defaults to "plan")'),
    content: tool.schema.string().describe('Plan content in markdown'),
  },
  async execute(args, context): Promise<string> {
    if (!args.content.trim()) {
      return JSON.stringify({ success: false, reason: 'empty_content' })
    }

    if (!SAFE_NAME.test(args.plan)) {
      return JSON.stringify({ success: false, reason: 'invalid_name', name: args.plan })
    }

    const artifact = args.artifact ?? 'plan'
    if (!SAFE_NAME.test(artifact)) {
      return JSON.stringify({ success: false, reason: 'invalid_artifact', artifact })
    }

    const planDir = path.join(context.worktree, '.opencode', 'plans', args.plan)
    await mkdir(planDir, { recursive: true })

    const filePath = path.join(planDir, `${artifact}.md`)
    await Bun.write(filePath, args.content)

    return JSON.stringify({ success: true, path: filePath })
  },
})
