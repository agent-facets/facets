#!/usr/bin/env bun

/**
 * Wait for packages to become available on the public npm registry.
 *
 * A successful `npm publish` means npm accepted the upload. npm then scans the
 * version before serving it — typically about five minutes, sometimes fifteen
 * or more — and may hold or block it. This polls each package's exact version
 * until the registry serves it or the deadline passes.
 *
 * Polling contract (defaults in DEFAULT_POLICY):
 * - One wall-clock deadline per invocation, covering requests and waits.
 * - Each round checks every pending package once, sequentially. A missing
 *   version or failed request never skips the rest of the round, and packages
 *   that become available are not checked again.
 * - Rounds start at least `pollIntervalMs` after the previous round ends.
 * - An HTTP 429 pauses all requests for `rateLimitCooldownMs` or the
 *   `Retry-After` delay, whichever is longer; the round then resumes with the
 *   next package.
 * - No request starts after the deadline, and each request is cut off at
 *   `requestTimeoutMs` or the remaining budget, whichever is shorter.
 *
 * Usage:
 *   bun scripts/release-cli/verify.ts <version>
 *   bun scripts/release-cli/verify.ts <version> <pkg1,pkg2,...>
 *
 * If no package list is provided, defaults to all 13 CLI packages
 * (12 platform binaries + the CLI wrapper) for standalone auditing.
 * Exits 0 when every package is available, 1 otherwise.
 */

import { io } from '../lib/io'
import { describeProbe, type ProbeOptions, probeVersion, type ReadinessProbe } from '../lib/npm-readiness'
import { allPackageNames } from './targets'

export interface VerifyClock {
  now: () => number
  sleep: (ms: number) => Promise<void>
}

export type Probe = (pkg: string, version: string, options: ProbeOptions) => Promise<ReadinessProbe>

export interface VerifyOptions {
  deadlineMs: number
  pollIntervalMs: number
  requestTimeoutMs: number
  rateLimitCooldownMs: number
  /** Longest silent stretch while waiting; keeps CI no-output timeouts from firing. */
  heartbeatMs: number
  clock: VerifyClock
  probe: Probe
}

export const DEFAULT_POLICY = {
  deadlineMs: 20 * 60_000,
  pollIntervalMs: 30_000,
  requestTimeoutMs: 10_000,
  rateLimitCooldownMs: 30_000,
  heartbeatMs: 60_000,
} as const

export interface UnresolvedPackage {
  pkg: string
  /** The most recent probe result, or null if the package was never checked. */
  last: ReadinessProbe | null
}

export type VerifyResult =
  | { ok: true; elapsedMs: number; rounds: number }
  | { ok: false; reason: 'deadline'; elapsedMs: number; rounds: number; unresolved: UnresolvedPackage[] }

const defaultClock: VerifyClock = { now: Date.now, sleep: io.shell.sleep }

function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`
}

export async function verify(
  packages: string[],
  version: string,
  overrides: Partial<VerifyOptions> = {},
): Promise<VerifyResult> {
  const opts: VerifyOptions = { ...DEFAULT_POLICY, clock: defaultClock, probe: probeVersion, ...overrides }
  const { clock } = opts
  const start = clock.now()
  const deadline = start + opts.deadlineMs
  const elapsed = () => clock.now() - start

  const last = new Map<string, ReadinessProbe>()
  let pending = [...new Set(packages)]
  let nextRequestAt = start
  let waitReason = ''
  let rounds = 0

  async function waitFor(ms: number, reason: string): Promise<void> {
    io.console.log(`   Waiting ${formatDuration(ms)} (${reason})...`)
    let remaining = ms
    while (remaining > 0) {
      const chunk = Math.min(remaining, opts.heartbeatMs)
      await clock.sleep(chunk)
      remaining -= chunk
      if (remaining > 0) io.console.log(`   ...still waiting, ${formatDuration(remaining)} left`)
    }
  }

  function deadlineReached(unresolvedNames: string[]): VerifyResult {
    const unresolved = unresolvedNames.map((pkg) => ({ pkg, last: last.get(pkg) ?? null }))
    io.console.error(
      `\n   Deadline of ${formatDuration(opts.deadlineMs)} reached after ${formatDuration(elapsed())} ` +
        `(${rounds} round(s)); ${unresolved.length} package(s) not available:`,
    )
    for (const { pkg, last: probe } of unresolved) {
      const detail = probe ? `last check: ${describeProbe(probe)}` : 'not checked before the deadline'
      io.console.error(`   ✗ ${pkg}@${version} — ${detail}`)
    }
    io.console.error(
      '\n   npm may still be scanning these versions, or may have held or blocked them.' +
        ' Public registry metadata cannot tell which.',
    )
    return { ok: false, reason: 'deadline', elapsedMs: elapsed(), rounds, unresolved }
  }

  io.console.log(`\n=== Verify Packages ===`)
  io.console.log(
    `\n   Waiting for ${pending.length} package(s) at version ${version} ` +
      `(deadline ${formatDuration(opts.deadlineMs)}, polling every ${formatDuration(opts.pollIntervalMs)})`,
  )

  while (pending.length > 0) {
    rounds++
    io.console.log(`\n   Round ${rounds} (${formatDuration(elapsed())} elapsed): checking ${pending.length} package(s)`)
    const stillPending: string[] = []

    for (const [index, pkg] of pending.entries()) {
      const wait = nextRequestAt - clock.now()
      if (wait > 0) {
        if (clock.now() + wait >= deadline) return deadlineReached([...stillPending, ...pending.slice(index)])
        await waitFor(wait, waitReason)
      }
      const remaining = deadline - clock.now()
      if (remaining <= 0) return deadlineReached([...stillPending, ...pending.slice(index)])

      const result = await opts.probe(pkg, version, {
        timeoutMs: Math.min(opts.requestTimeoutMs, remaining),
        now: clock.now,
      })
      last.set(pkg, result)

      if (result.outcome === 'ready') {
        io.console.log(`   ✓ ${pkg}@${version} ${describeProbe(result)}`)
        continue
      }

      io.console.log(`   … ${pkg}@${version} ${describeProbe(result)}`)
      stillPending.push(pkg)
      if (result.outcome === 'rate-limited') {
        const cooldown = Math.max(opts.rateLimitCooldownMs, result.retryAfterMs ?? 0)
        nextRequestAt = Math.max(nextRequestAt, clock.now() + cooldown)
        waitReason = 'registry rate limit'
      }
    }

    pending = stillPending
    if (pending.length === 0) break

    io.console.log(`   ${pending.length} package(s) not available yet`)
    const nextRound = clock.now() + opts.pollIntervalMs
    if (nextRound > nextRequestAt) {
      nextRequestAt = nextRound
      waitReason = 'next round'
    }
  }

  io.console.log(`\n=== All ${new Set(packages).size} package(s) available after ${formatDuration(elapsed())} ===`)
  return { ok: true, elapsedMs: elapsed(), rounds }
}

if (import.meta.main) {
  const version = process.argv[2]
  if (!version) {
    io.console.error('Usage: bun scripts/release-cli/verify.ts <version> [pkg1,pkg2,...]')
    process.exit(1)
  }
  const packagesArg = process.argv[3]
  const packages = packagesArg ? packagesArg.split(',').filter(Boolean) : allPackageNames()
  const result = await verify(packages, version)
  process.exit(result.ok ? 0 : 1)
}
