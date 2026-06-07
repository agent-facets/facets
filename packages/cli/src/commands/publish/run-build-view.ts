import { loadInstalledAdapters } from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import { BuildView } from '../../tui/views/build/build-view.tsx'

/**
 * Mount `<BuildView>` for the publish command's build/rebuild branch
 * and capture whether the build succeeded. Loads installed adapters
 * first (same as the `build` command) so the build pipeline can
 * validate adapter metadata on the same terms the standalone `build`
 * would.
 *
 * Lives in its own module so the publish-command tests can mock the
 * trampoline via `mock.module('./run-build-view.ts', ...)` and skip the
 * Ink mount in test runs. The mock substitutes a direct
 * `runBuildPipeline` + `writeBuildOutput` call that produces the same
 * `dist/<name>-<version>.facet` the real `<BuildView>` would, without
 * fighting `bun:test` for stdin or TTY.
 *
 * Returns `{ ok: true }` on success and `{ ok: false }` on any failure
 * — `<BuildView>` already rendered the failure inline, so the caller
 * just propagates the exit code.
 */
export async function runBuildViewAndCapture(projectRoot: string): Promise<{ ok: boolean }> {
  const adapters = await loadInstalledAdapters(undefined, {
    onWarn: (line) => console.error(line),
  })
  const state: { failed: boolean } = { failed: false }
  const instance = render(
    createElement(BuildView, {
      rootDir: projectRoot,
      emitManifest: false,
      adapters,
      onFailure: () => {
        state.failed = true
      },
    }),
  )
  try {
    await instance.waitUntilExit()
  } catch {
    // <BuildView> deferred-exits with an Error on failure paths so
    // React can paint the failure state first. The Error itself
    // surfaces here as a rejection from waitUntilExit; the view has
    // already drawn the user-facing report.
    state.failed = true
  }
  return { ok: !state.failed }
}
