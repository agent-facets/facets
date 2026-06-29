// `main` is the production stage; it owns the apex `agentfacets.io` and lives in
// the production AWS account (deployed only via CircleCI). All other stages are
// non-production and live in the dedicated staging AWS account under the
// delegated `staging.agentfacets.io` hosted zone, so a local developer deploy
// can never touch production DNS or production resources.
export const SITE_DOMAIN = $app.stage === 'main' ? 'agentfacets.io' : `${$app.stage}.staging.agentfacets.io`

export const SITE_REDIRECTS = $app.stage === 'main' ? ['www.agentfacets.io'] : undefined
