/**
 * Shared OIDC trusted-publishing instructions printer.
 *
 * Both `scripts/release-cli/seed.ts` and `scripts/release/seed-adapters.ts`
 * publish `v0.0.1` placeholder packages to npm to claim package names. After
 * seeding, each package's trusted publisher must be configured on npm — the
 * instructions below tell the developer exactly what to enter.
 *
 * Keeping the CircleCI project coordinates and the print routine here means
 * both seed scripts stay in sync with one source of truth.
 */

/** CircleCI OIDC configuration for npm trusted publishing. */
export const CIRCLECI_OIDC = {
  organizationId: 'bfa561da-d33e-4a2a-a46d-48e096a828e0',
  projectId: '46274a40-97ed-41fd-a745-9702a7131ccc',
  pipelineDefinitionId: '9d2f5823-f2c9-4cba-918a-e7d0dc2f658a',
  contextIds: '691cddb9-b839-41e8-bc5c-ebb4484a2a1f',
  vcsOrigin: 'github.com/agent-facets/facets',
} as const

/** Path to the full OIDC setup guide, relative to the repo root. */
export const OIDC_SETUP_GUIDE = 'OIDC-SETUP.md'

/**
 * Print OIDC trusted-publishing configuration instructions for the given
 * packages. Emits CircleCI coordinates and a link to each package's npm
 * access page.
 */
export function printOidcInstructions(packages: string[]): void {
  const log = (msg: string) => console.log(msg)
  log('\n   Configure OIDC trusted publishing for each new package.')
  log("   Go to each package's npm access page and add CircleCI as a trusted publisher:")
  log('')
  log(`     Organization ID:          ${CIRCLECI_OIDC.organizationId}`)
  log(`     Project ID:               ${CIRCLECI_OIDC.projectId}`)
  log(`     Pipeline Definition ID:   ${CIRCLECI_OIDC.pipelineDefinitionId}`)
  log(`     Context IDs:              ${CIRCLECI_OIDC.contextIds}`)
  log(`     VCS Origin:               ${CIRCLECI_OIDC.vcsOrigin}`)
  log('')
  log('   Package access pages:')
  for (const pkg of packages) {
    log(`     → https://www.npmjs.com/package/${pkg}/access`)
  }
  log(`\n   Full setup guide: ${OIDC_SETUP_GUIDE}`)
}
