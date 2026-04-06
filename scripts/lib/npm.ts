/**
 * npm registry helpers for seed and publish scripts.
 *
 * All I/O goes through the io adapter for testability.
 */

import path from 'node:path'
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

/** Add a dist-tag to a package version. */
export async function distTagAdd(pkg: string, version: string, tag: string): Promise<void> {
  await io.distTagAdd(pkg, version, tag)
}
