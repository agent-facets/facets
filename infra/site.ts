/**
 * agentfacets.io apex hosting.
 *
 * - `/` is served by the landing StaticSite (packages/landing).
 * - `/install` is served by the install Lambda (packages/functions/src/install.ts),
 *   which returns the bash installer script from packages/landing/scripts/install.sh.
 * - `docs.agentfacets.io` serves Mintlify content; the CNAME pointing it at
 *   Mintlify's edge (`cname.mintlify-dns.com`) is defined in `infra/dns.ts`.
 *   The docs themselves are hosted by Mintlify, not by anything in this stack.
 * - No WAF: the site is static CloudFront-hosted content with no server-side
 *   attack surface (no backend, DB, or user input), so WAF filtering adds
 *   cost without value.
 * - `www.agentfacets.io` 301-redirects to the apex via SST's native
 *   `domain.redirects` on the main stage.
 */

import { SITE_DOMAIN, SITE_REDIRECTS } from './helpers/domain'

const siteRouter = new sst.aws.Router('AgentFacetsSite', {
  domain: {
    name: SITE_DOMAIN,
    redirects: SITE_REDIRECTS,
  },
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
    // SST iterates `fileOptions` in reverse and uploads each matched file
    // with the first rule that claims it (see
    // .sst/platform/src/components/aws/static-site.ts, the
    // `uploadAssets` -> `for (const fileOption of fileOptions.reverse())`
    // loop). Files matching NO rule are silently dropped, so this list
    // must be exhaustive — prefer a catch-all + specific overrides over
    // an allowlist of extensions.
    fileOptions: [
      // Listed first, runs LAST after SST's internal .reverse(). Sweeps
      // every file the HTML rule didn't claim: JS, CSS, fonts, images,
      // favicons, static data. Safe because Vite emits content-hashed
      // filenames for everything under /assets/.
      {
        files: '**',
        cacheControl: 'max-age=31536000,public,immutable',
      },
      // Listed last, runs FIRST after .reverse() so the catch-all doesn't
      // claim index.html with the wrong cache header. HTML is the single
      // mutable URL whose content changes deploy-to-deploy.
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
