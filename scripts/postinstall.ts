/**
 * Postinstall: set up local dev tooling quietly.
 *
 * Runs three steps in sequence:
 *   1. lefthook install        — git hooks
 *   2. facet adapter install   — install the opencode adapter
 *   3. facet install           — install repo facets
 *
 * Each step's stdout/stderr is captured and only printed if the step
 * fails. On success we print a single line per step so the user can
 * see what happened without drowning in subprocess output.
 */

import { $ } from 'bun'

/**
 * Re-entrancy guard. Steps 2 and 3 run the in-repo CLI, which can spawn
 * a nested `bun install` (e.g. the adapter bundler's install-and-retry
 * fallback). A nested install resolves the workspace root and re-runs
 * this very script; without the guard that recursion never terminates.
 * The variable is inherited by every child process, so the nested run
 * exits immediately and the parent's steps remain the only ones doing
 * real work.
 */
const REENTRY_GUARD = 'FACETS_POSTINSTALL_ACTIVE'
if (process.env[REENTRY_GUARD] === '1') {
  console.log('  ↩ nested bun install — dev setup already running in a parent process, skipping')
  process.exit(0)
}
process.env[REENTRY_GUARD] = '1'

type Step = {
  label: string
  run: () => Promise<void>
}

const steps: Step[] = [
  {
    label: 'git hooks',
    run: () => $`mise exec -- lefthook install`.quiet().then(() => undefined),
  },
  {
    label: 'opencode adapter',
    // Install from the workspace source, not npm. The in-repo CLI's
    // adapter API support set advances with the in-repo SDK, so a
    // published adapter release may lag behind what this checkout
    // requires (the rollout publishes adapters before the CLI, but the
    // monorepo's own bootstrap can't depend on that ordering — it would
    // deadlock the release CI that publishes the first compatible
    // release). The local path bundles and verifies the same adapter
    // source this checkout was built against.
    run: () => $`bun dev adapter install ./packages/adapters/opencode`.quiet().then(() => undefined),
  },
  {
    label: 'facets',
    run: () => $`bun dev install`.quiet().then(() => undefined),
  },
]

for (const step of steps) {
  try {
    await step.run()
    console.log(`  ✓ ${step.label}`)
  } catch (err) {
    console.error(`  ✗ ${step.label}`)
    // Bun's $ throws a ShellError with .stdout/.stderr buffers when
    // .quiet() suppresses live output; surface them on failure so the
    // user can actually debug.
    const shellErr = err as { stdout?: Buffer; stderr?: Buffer; message?: string }
    if (shellErr.stdout?.length) {
      console.error(shellErr.stdout.toString())
    }
    if (shellErr.stderr?.length) {
      console.error(shellErr.stderr.toString())
    }
    if (!shellErr.stdout && !shellErr.stderr && shellErr.message) {
      console.error(shellErr.message)
    }
    process.exit(1)
  }
}
