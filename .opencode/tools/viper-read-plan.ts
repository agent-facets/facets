import { stat } from 'node:fs/promises'
import path from 'node:path'
import { tool } from '@opencode-ai/plugin'
import { markRead } from '../lib/viper-read-tracker.ts'

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

    // Stat-before-read + post-read re-stat verification:
    //   1. Capture pre-read mtime.
    //   2. Read content.
    //   3. Re-stat and verify mtime didn't change. If it did, another
    //      writer modified the file between our stat and read, so the
    //      content we hold is from a different version than the mtime
    //      we'd record. Refuse rather than poison the read tracker.
    try {
      const preStats = await stat(filePath)
      const content = await Bun.file(filePath).text()
      const postStats = await stat(filePath)
      if (postStats.mtimeMs !== preStats.mtimeMs) {
        // Concurrent write between stat and read; treat as not-found
        // to keep the public surface stable.
        return JSON.stringify({ success: false, reason: 'not_found', plan: args.plan, artifact })
      }
      markRead(context.sessionID, args.plan, artifact, preStats.mtimeMs)
      return JSON.stringify({ content, plan: args.plan, artifact })
    } catch {
      return JSON.stringify({ success: false, reason: 'not_found', plan: args.plan, artifact })
    }
  },
})
