/// <reference path="./.sst/platform/config.d.ts" />

// Production (`main`) and non-production stages live in separate AWS accounts:
//   - `main`     → dedicated prod account 445459853351 (agentfacets.io), deployed
//                  ONLY by CircleCI (apex agentfacets.io).
//   - all others → `agent-facets-staging` account, under staging.agentfacets.io.
//
// `main` is CI-only. CircleCI is detected via the `CIRCLECI` env var (set only
// by CircleCI, unlike the broad `CI` var that any CI provider or local shell may
// set); any local attempt to operate on `main` throws. The `main` stage is also
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

// CircleCI sets `CIRCLECI=true`. We key the OIDC/no-profile branch off this
// specific signal rather than the broad `CI` var, which any CI provider or a
// local shell can set — that breadth would let a non-CircleCI run skip the
// `main` guard below.
const IS_CIRCLECI = process.env.CIRCLECI === 'true'

function resolveAwsProfile(stage: string): string | undefined {
  // In CircleCI, credentials come from the environment (OIDC); never pin a profile.
  if (IS_CIRCLECI) return undefined

  // `main` is CI-only; any local invocation throws.
  if (stage === 'main') {
    throw new Error('Refusing to operate on the `main` stage locally. `main` deploys run ' + 'through CircleCI only.')
  }

  // For non-`main` stages, an explicit AWS_PROFILE is honored ONLY if it is the
  // staging profile. Any other value (e.g. a prod profile lingering in the
  // shell) is refused, so a developer machine can never target a non-staging
  // account. This is a footgun guard; the real isolation is the account/SSO
  // boundary.
  if (process.env.AWS_PROFILE && process.env.AWS_PROFILE !== STAGING_PROFILE) {
    throw new Error(
      `Refusing to use AWS profile "${process.env.AWS_PROFILE}" for a non-\`main\` stage. ` +
        `Only "${STAGING_PROFILE}" is permitted; edit sst.config.ts if you genuinely need another.`,
    )
  }

  // Non-main stages target the staging account.
  return process.env.AWS_PROFILE ?? STAGING_PROFILE
}

export default $config({
  app(input) {
    // A stage must always be resolved; an absent stage is an illegal state, so
    // fail loud rather than silently defaulting it.
    const stage = input?.stage
    if (!stage) {
      throw new Error('No SST stage resolved. A stage is always required; refusing to continue.')
    }
    const isMain = stage === 'main'
    return {
      name: 'agent-facets',
      // `main` resources are retained on destroy and the stage is protected
      // against removal.
      removal: isMain ? 'retain' : 'remove',
      protect: isMain,
      home: 'aws',
      providers: {
        aws: {
          profile: resolveAwsProfile(stage),
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
