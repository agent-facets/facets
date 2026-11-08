import { homedir } from 'node:os'
import type { Adapter, PlanningContext } from '@agent-facets/adapter'

/**
 * The planning context for one operation on one project.
 *
 * Captured once, after the operation's lock is held, and handed unchanged to
 * every adapter request the operation makes — preparation and every replan
 * alike — so a value that changes in the process environment mid-run cannot
 * make two plans for one operation disagree about where things live.
 *
 * The environment holds exactly the union of the variables the selected
 * adapters' enabled capabilities declare in `locationEnvironment`, and
 * nothing else: an undeclared value never leaves this process for an
 * adapter. The SDK further narrows each request to what the receiving
 * capability declared.
 *
 * `environment` and `home` exist so tests can supply them; production callers
 * pass neither.
 */
export function captureProjectPlanningContext(
  projectRoot: string,
  adapters: readonly Adapter[],
  ambient: { readonly environment?: Readonly<Record<string, string | undefined>>; readonly home?: string } = {},
): PlanningContext {
  const source = ambient.environment ?? process.env
  const environment: Record<string, string> = {}
  for (const name of declaredLocationEnvironment(adapters)) {
    const value = source[name]
    if (value !== undefined) environment[name] = value
  }
  return Object.freeze({
    target: Object.freeze({ scope: 'project', projectRoot }),
    homeDirectory: ambient.home ?? homedir(),
    environment: Object.freeze(environment),
  })
}

/** Every environment-variable name any enabled capability of these adapters declares, in first-seen order. */
function declaredLocationEnvironment(adapters: readonly Adapter[]): readonly string[] {
  const names = new Set<string>()
  for (const adapter of adapters) {
    for (const capability of [adapter.assets, adapter.mcpServers]) {
      if (capability === false) continue
      for (const name of capability.locationEnvironment) names.add(name)
    }
  }
  return [...names]
}
