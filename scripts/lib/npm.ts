/**
 * npm registry helpers for seed and publish scripts.
 *
 * All I/O goes through the io adapter for testability.
 */

import path from 'node:path'
import { NPM_REGISTRY } from './constants'
import { io } from './io'

/** Check if the current user is logged in to npm. Returns the username or null. */
export async function whoami(): Promise<string | null> {
  try {
    const result = await io.whoami()
    return result.stdout.toString().trim() || null
  } catch {
    return null
  }
}

/** Check if a package name exists in the npm registry (any version). */
export async function packageExists(pkg: string): Promise<boolean> {
  try {
    await io.viewName(pkg)
    return true
  } catch {
    return false
  }
}

/** Check if a specific version of a package exists in the npm registry. */
export async function versionExists(pkg: string, version: string): Promise<boolean> {
  try {
    const result = await io.viewVersion(pkg, version)
    return result.stdout.toString().trim() === version
  } catch {
    return false
  }
}

/**
 * Publish a placeholder package to npm to bootstrap OIDC trusted publishing.
 * Creates a temp directory with a minimal package.json and publishes it.
 */
export async function publishPlaceholder(pkg: string): Promise<void> {
  const tmp = path.join(import.meta.dir, '..', '..', '.tmp-bootstrap')
  await io.rm(tmp)
  await io.mkdir(tmp)

  await io.writeFile(
    path.join(tmp, 'package.json'),
    JSON.stringify(
      {
        name: pkg,
        version: '0.0.1',
        description: 'Placeholder for OIDC trusted publishing bootstrap',
      },
      null,
      2,
    ),
  )

  try {
    await io.publishPlain(tmp)
  } finally {
    await io.rm(tmp)
  }
}

/** Get the version that a dist-tag currently points to, or null if it doesn't exist. */
export async function latestVersion(pkg: string): Promise<string | null> {
  try {
    const result = await io.viewDistTag(pkg, 'latest')
    return result.stdout.toString().trim() || null
  } catch {
    return null
  }
}

/**
 * Exchange an OIDC JWT for a short-lived npm registry token scoped to a package.
 *
 * This replicates what `npm publish` does internally with trusted publishing,
 * but allows us to use the token for operations beyond publish (e.g. dist-tags).
 *
 * The token exchange pattern (JWT → short-lived npm token via the
 * `/-/npm/v1/oidc/token/exchange/package/` endpoint) was adapted from Nuxt's
 * release script. Credit to the Nuxt team for pioneering this approach.
 *
 * @see https://github.com/nuxt/nuxt/blob/main/scripts/release.ts
 * @license MIT — Nuxt contributors
 */
export async function exchangeOidcToken(packageName: string, oidcJwt: string): Promise<string> {
  const encodedName = packageName.replace('/', '%2f')
  const url = `${NPM_REGISTRY}/-/npm/v1/oidc/token/exchange/package/${encodedName}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${oidcJwt}` },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`OIDC token exchange failed for ${packageName}: ${res.status} — ${body}`)
  }
  const { token } = (await res.json()) as { token: string }
  if (!token) throw new Error(`OIDC token exchange returned empty token for ${packageName}`)
  return token
}

/**
 * Add a dist-tag to a package using the npm registry HTTP API directly.
 *
 * Uses a short-lived npm token (from {@link exchangeOidcToken}) instead of
 * `npm dist-tag add`, which doesn't support OIDC trusted publishing.
 *
 * @see https://github.com/npm/cli/issues/8547
 */
export async function addDistTagViaApi(
  packageName: string,
  version: string,
  tag: string,
  npmToken: string,
): Promise<void> {
  const encodedName = packageName.replace('/', '%2f')
  const url = `${NPM_REGISTRY}/-/package/${encodedName}/dist-tags/${encodeURIComponent(tag)}`
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${npmToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(version),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Failed to add dist-tag ${tag} to ${packageName}@${version}: ${res.status} — ${body}`)
  }
}
