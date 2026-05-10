import { stat } from 'node:fs/promises'
import path from 'node:path'
import { tool } from '@opencode-ai/plugin'
import { atomicWriteFileSync } from '../lib/atomic-write.ts'
import { getReadMtime, markRead } from '../lib/viper-read-tracker.ts'

const SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/

/**
 * Count non-overlapping occurrences of `needle` in `haystack`.
 * Uses indexOf in a loop so we don't pay the cost of allocating
 * an array of all matches just to know if there are 0, 1, or more.
 */
function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0
  let count = 0
  let from = 0
  while (true) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) return count
    count++
    from = idx + needle.length
  }
}

export default tool({
  description:
    "Edit a VIPER plan artifact in place via exact string replacement. Mirrors OpenCode's Edit tool: requires the artifact to have been read this session and unchanged on disk since.",
  args: {
    plan: tool.schema.string().describe('Plan name to edit'),
    artifact: tool.schema.string().optional().describe('Artifact name (defaults to "plan")'),
    oldString: tool.schema
      .string()
      .describe('Exact text to find. Include enough surrounding context to be unique unless replaceAll is true.'),
    newString: tool.schema.string().describe('Replacement text'),
    replaceAll: tool.schema.boolean().optional().describe('Replace every occurrence of oldString. Defaults to false.'),
  },
  async execute(args, context): Promise<string> {
    if (!SAFE_NAME.test(args.plan)) {
      return JSON.stringify({ success: false, reason: 'invalid_name', name: args.plan })
    }

    const artifact = (args.artifact ?? 'plan').replace(/\.md$/, '')
    if (!SAFE_NAME.test(artifact)) {
      return JSON.stringify({ success: false, reason: 'invalid_artifact', artifact })
    }

    const filePath = path.join(context.worktree, '.opencode', 'plans', args.plan, `${artifact}.md`)

    // Existence check.
    let stats: Awaited<ReturnType<typeof stat>>
    try {
      stats = await stat(filePath)
    } catch {
      return JSON.stringify({ success: false, reason: 'not_found', plan: args.plan, artifact })
    }

    // Read-first guard.
    const lastReadMtime = getReadMtime(context.sessionID, args.plan, artifact)
    if (lastReadMtime === undefined) {
      return JSON.stringify({
        success: false,
        reason: 'must_read_first',
        message: 'Read the plan with viper-read-plan (or write it with viper-write-plan) before editing.',
      })
    }
    if (stats.mtimeMs > lastReadMtime) {
      return JSON.stringify({
        success: false,
        reason: 'stale_read',
        message: 'Artifact was modified since last read. Re-read with viper-read-plan before editing.',
      })
    }

    if (args.oldString === args.newString) {
      return JSON.stringify({ success: false, reason: 'no_change' })
    }

    const original = await Bun.file(filePath).text()

    // Re-stat after the read to close the TOCTOU window between the
    // existence stat above and the read here. If the file changed
    // between then and now, the content we just read is newer than
    // what the session was tracking — treat it as a stale read.
    const postReadStats = await stat(filePath)
    if (postReadStats.mtimeMs > stats.mtimeMs) {
      return JSON.stringify({
        success: false,
        reason: 'stale_read',
        message: 'Artifact was modified since last read. Re-read with viper-read-plan before editing.',
      })
    }

    const matches = countOccurrences(original, args.oldString)

    if (matches === 0) {
      return JSON.stringify({ success: false, reason: 'old_string_not_found' })
    }

    const replaceAll = args.replaceAll ?? false
    if (matches > 1 && !replaceAll) {
      return JSON.stringify({
        success: false,
        reason: 'ambiguous_match',
        count: matches,
        message: 'Provide more context in oldString to make it unique, or set replaceAll: true.',
      })
    }

    // Both branches use literal replacement (no `$&`/`` $` ``/`$'`/`$N`
    // interpretation). String.prototype.replace would interpret those
    // patterns in newString, which is wrong for plan files that may
    // contain shell variables, prices, or regex examples.
    let updated: string
    if (replaceAll) {
      updated = original.split(args.oldString).join(args.newString)
    } else {
      const idx = original.indexOf(args.oldString)
      // matches > 0 was checked above, so idx !== -1.
      updated = original.slice(0, idx) + args.newString + original.slice(idx + args.oldString.length)
    }

    atomicWriteFileSync(filePath, updated)

    // Refresh tracker mtime so the same session can edit again without
    // re-read. Best-effort: the write already succeeded, so a transient
    // FS error here should not turn it into a reported failure. Worst
    // case: the next viper-edit-plan in this session has to re-read.
    try {
      const newStats = await stat(filePath)
      markRead(context.sessionID, args.plan, artifact, newStats.mtimeMs)
    } catch {
      // Intentionally swallowed.
    }

    return JSON.stringify({
      success: true,
      path: filePath,
      replacements: replaceAll ? matches : 1,
    })
  },
})
