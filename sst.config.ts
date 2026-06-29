/// <reference path="./.sst/platform/config.d.ts" />

// Production (`main`) and non-production stages live in separate AWS accounts:
//   - `main`     → dedicated prod account 445459853351 (agentfacets.io), deployed
//                  ONLY by CircleCI (apex agentfacets.io).
//   - all others → `agent-facets-staging` account, under staging.agentfacets.io.
//
// `main` is CI-only. CI is detected via the `CI` env var (set by CircleCI);
// any local attempt to operate on `main` throws. The `main` stage is also
// permanently protected and its resources retained, so removing it requires a
// deliberate edit to this file.
// Dedicated, repo-owned profile name. We deliberately do NOT reuse the shared
// `facet-cafe` profile name: it lives in a shared ~/.aws/config and the sibling
// `facet.cafe` repo repoints it (e.g. to its own staging account), so depending
// on that name would silently target the wrong account. `agent-facets-staging`
// → staging account 705557196199 (staging.agentfacets.io). The dedicated prod
// account 445459853351 (agentfacets.io) is never selected by a profile here:
// `main` is CI-only and CI authenticates via OIDC (no profile). Production no
// longer shares the `facet.cafe` account (726911960883); that account hosts only
// the sibling `facet.cafe` app now.
const STAGING_PROFILE = 'agent-facets-staging'

function resolveAwsProfile(stage: string): string | undefined {
  // In CI, credentials come from the environment (OIDC); never pin a profile.
  if (process.env.CI) return undefined

  // `main` is CI-only; any local invocation throws.
  if (stage === 'main') {
    throw new Error('Refusing to operate on the `main` stage locally. `main` deploys run ' + 'through CircleCI only.')
  }

  // An explicit AWS_PROFILE always wins for non-main stages. This lets an
  // operator target a specific staging account for maintenance (e.g. tearing
  // down an old stage) without the stage→account default getting in the way.
  if (process.env.AWS_PROFILE) return process.env.AWS_PROFILE

  // Non-main stages otherwise target the staging account.
  return STAGING_PROFILE
}

export default $config({
  app(input) {
    const isMain = input?.stage === 'main'
    return {
      name: 'agent-facets',
      // `main` resources are retained on destroy and the stage is protected
      // against removal.
      removal: isMain ? 'retain' : 'remove',
      protect: isMain,
      home: 'aws',
      providers: {
        aws: {
          profile: resolveAwsProfile(input?.stage),
          version: '7.20.0',
        },
      },
    }
  },
  async run() {
    const { readdirSync } = await import('node:fs')

    const outputs = {}

    for (const entry of readdirSync('./infra/', { withFileTypes: true })) {
      if (!entry.isFile()) continue // skip directories
      if (!entry.name.endsWith('.ts')) continue // skip non-TS files

      const result = await import(`./infra/${entry.name}`)

      if (result.outputs) Object.assign(outputs, result.outputs)
    }

    return outputs
  },
})
