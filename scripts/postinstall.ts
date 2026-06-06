/**
 * Postinstall: set up local dev tooling quietly.
 *
 * Runs four steps in sequence:
 *   1. lefthook install        — git hooks
 *   2. facet install           — install repo facets
 *   3. facet adapter install   — install the opencode adapter
 *   4. sst install             — SST link types (skipped in CI)
 *
 * Each step's stdout/stderr is captured and only printed if the step
 * fails. On success we print a single line per step so the user can
 * see what happened without drowning in subprocess output.
 */

import { $ } from 'bun'

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
    run: () => $`bun dev adapter install opencode`.quiet().then(() => undefined),
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
