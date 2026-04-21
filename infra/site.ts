/**
 * agentfacets.io apex hosting.
 *
 * - `/` is served by the landing StaticSite (packages/landing).
 * - `/install` is served by the install Lambda (packages/functions/src/install.ts),
 *   which returns the bash installer script from packages/landing/scripts/install.sh.
 * - `docs.agentfacets.io` serves Mintlify content; the CNAME pointing it at
 *   Mintlify's edge (`cname.mintlify-dns.com`) is defined in `infra/dns.ts`.
 *   The docs themselves are hosted by Mintlify, not by anything in this stack.
 * - WAF is enabled on the `main` stage only (SST's built-in managed rules +
 *   default rate limit). Preview and personal stages run without WAF to keep
 *   iteration cheap.
 * - `www.agentfacets.io` 301-redirects to the apex via SST's native
 *   `domain.redirects` on the main stage.
 */

import { SITE_DOMAIN, SITE_REDIRECTS } from './helpers/domain'

const isMain = $app.stage === 'main'

const siteRouter = new sst.aws.Router('AgentFacetsSite', {
  domain: {
    name: SITE_DOMAIN,
    redirects: SITE_REDIRECTS,
  },
  waf: isMain ? true : undefined,
  invalidation: {
    paths: ['/*'],
    wait: false,
  },
})

const landing = new sst.aws.StaticSite('AgentFacetsLanding', {
  router: {
    instance: siteRouter,
  },
  build: {
    command: 'bun run --cwd packages/landing build',
    output: 'packages/landing/dist',
  },
  dev: {
    command: 'bun run --cwd packages/landing dev',
    url: 'http://localhost:5173',
  },
  assets: {
    fileOptions: [
      {
        files: ['**/*.css', '**/*.js', '**/*.webp', '**/*.svg', '**/*.ico', '**/*.json'],
        cacheControl: 'max-age=31536000,public,immutable',
      },
      {
        files: '**/*.html',
        cacheControl: 'max-age=3600,public',
      },
    ],
  },
})

const installFn = new sst.aws.Function('InstallScript', {
  handler: 'packages/functions/src/install.handler',
  runtime: 'nodejs24.x',
  timeout: '5 seconds',
  memory: '128 MB',
  url: {
    router: {
      instance: siteRouter,
      path: '/install',
    },
  },
  copyFiles: [{ from: 'packages/landing/scripts/install.sh', to: 'scripts/install.sh' }],
  logging: {
    retention: '1 week',
  },
})

export const outputs = {
  siteUrl: siteRouter.url,
  landingUrl: landing.url,
  installUrl: installFn.url,
}
