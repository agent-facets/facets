import { mkdir, stat } from 'node:fs/promises'
import path from 'node:path'
import { tool } from '@opencode-ai/plugin'
import { atomicWriteFileSync } from '../lib/atomic-write.ts'
import { markRead } from '../lib/viper-read-tracker.ts'

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

    const artifact = (args.artifact ?? 'plan').replace(/\.md$/, '')
    if (!SAFE_NAME.test(artifact)) {
      return JSON.stringify({ success: false, reason: 'invalid_artifact', artifact })
    }

    const planDir = path.join(context.worktree, '.opencode', 'plans', args.plan)
    await mkdir(planDir, { recursive: true })

    const filePath = path.join(planDir, `${artifact}.md`)
    atomicWriteFileSync(filePath, args.content)

    // Record this session's view of the file so subsequent viper-edit-plan
    // calls don't have to read-then-edit what they just wrote.
    // Tracker update is best-effort: the write already succeeded, so a
    // transient FS error or external deletion between write and stat
    // should not turn a successful write into a reported failure.
    // Worst case: a follow-up viper-edit-plan in this session has to
    // re-read the file via viper-read-plan first.
    try {
      const stats = await stat(filePath)
      markRead(context.sessionID, args.plan, artifact, stats.mtimeMs)
    } catch {
      // Intentionally swallowed.
    }

    return JSON.stringify({ success: true, path: filePath })
  },
})
