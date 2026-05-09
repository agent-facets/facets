/**
 * Per-(session, plan, artifact) read-tracking for the viper-* tools.
 *
 * Tools call `markRead` after they've read or written an artifact so the
 * LLM in that session has a "fresh" view of it on disk. `viper-edit-plan`
 * then refuses to operate unless:
 *
 *   - the artifact has been read in this session at all, AND
 *   - the file's current mtime is not newer than what was recorded
 *     (i.e. nothing modified the file behind the LLM's back since it
 *     was last seen).
 *
 * State is module-level and lives only for the lifetime of the OpenCode
 * plugin process. All viper-* tools share this process at runtime,
 * so the same Map instance is visible to all of them.
 */
const readMtimes = new Map<string, number>()

function key(sessionID: string, plan: string, artifact: string): string {
  return `${sessionID}:${plan}:${artifact}`
}

export function markRead(sessionID: string, plan: string, artifact: string, mtimeMs: number): void {
  readMtimes.set(key(sessionID, plan, artifact), mtimeMs)
}

export function getReadMtime(sessionID: string, plan: string, artifact: string): number | undefined {
  return readMtimes.get(key(sessionID, plan, artifact))
}
