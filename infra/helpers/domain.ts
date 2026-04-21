export const SITE_DOMAIN = $app.stage === 'main' ? 'agentfacets.io' : `${$app.stage}.agentfacets.io`

export const SITE_REDIRECTS = $app.stage === 'main' ? ['www.agentfacets.io'] : undefined
