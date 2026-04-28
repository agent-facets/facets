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
    const result = await io.npm.whoami()
    return result.stdout.toString().trim() || null
  } catch {
    return null
  }
}

/** Check if a package name exists in the npm registry (any version). */
export async function packageExists(pkg: string): Promise<boolean> {
  try {
    await io.npm.viewName(pkg)
    return true
  } catch {
    return false
  }
}

/** Check if a specific version of a package exists in the npm registry. */
export async function versionExists(pkg: string, version: string): Promise<boolean> {
  try {
    const result = await io.npm.checkVersion(pkg, version)
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
  await io.shell.rm(tmp)
  await io.shell.mkdir(tmp)

  await io.shell.writeFile(
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
    await io.npm.publishPlain(tmp)
  } finally {
    await io.shell.rm(tmp)
  }
}

/** Mint a CircleCI OIDC token for npm trusted publishing and set NPM_ID_TOKEN. */
export async function mintNpmToken(): Promise<void> {
  process.env.NPM_ID_TOKEN = (await io.shell.mintCircleOidcToken()).trim()
}

/**
 * Extract the tarball filename from `bun pm pack --quiet` stdout.
 *
 * `bun pm pack` runs the prepack and postpack lifecycle scripts inline and
 * forwards their stdout into its own stdout. Even with `--quiet`, those
 * lifecycle scripts can print to stdout, so the captured output may be
 * multi-line — the filename is just one line among diagnostic noise.
 * Naive `.trim()` only strips outer whitespace and would forward a
 * multi-line blob to `npm publish`, tripping `EUNSUPPORTEDPROTOCOL` when
 * npm parses the leading `prepack:` chunk as a URL protocol scheme.
 *
 * Reference: CircleCI job 782 failed publishing
 * `@agent-facets/adapter-opencode@0.4.2` for exactly this reason.
 *
 * Strategy: split on newlines, trim each line, keep the ones ending in
 * `.tgz`. Throw if zero matches (parser broke or pack produced nothing) or
 * more than one match (ambiguous — refuse to guess which tarball to publish).
 *
 * The companion fix is sending prepack/postpack diagnostic logs to stderr
 * (`scripts/prepack.ts`, `scripts/postpack.ts`), which means in practice
 * stdout SHOULD already be a single line. This helper is the defensive
 * second layer that catches future regressions if anything else ever leaks
 * to stdout — a Bun behavior change, a third-party tool added to the
 * lifecycle, or a contributor adding stdout logging somewhere.
 */
export function extractPackFilename(stdout: string): string {
  const matches = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.endsWith('.tgz'))

  if (matches.length === 0) {
    throw new Error(`pack stdout contained no .tgz filename: ${JSON.stringify(stdout)}`)
  }
  if (matches.length > 1) {
    throw new Error(
      `pack stdout contained multiple .tgz filenames (ambiguous): ${JSON.stringify(matches)} from raw: ${JSON.stringify(stdout)}`,
    )
  }

  return matches[0] as string
}

/**
 * Pack a package and publish the resulting tarball.
 *
 * Pack-then-upload (two commands) avoids a lifecycle race for npm: when given
 * a pre-built tarball, npm builds the registry packument from the
 * `package.json` *inside* the tarball, so the packument and tarball match by
 * construction. Pack stdout is parsed via `extractPackFilename` to handle
 * lifecycle script output safely — `npm publish` accepts a single
 * <package-spec>, so we forward exactly one filename arg, never a glob and
 * never a multi-line blob.
 *
 * @param dir Path to the package directory containing `package.json`.
 * @param tag Optional npm dist-tag (e.g., `latest`, `next`). When omitted,
 *            npm uses `publishConfig.tag` from `package.json` if present.
 */
export async function packAndPublish(dir: string, tag?: string): Promise<void> {
  const filename = extractPackFilename(await io.npm.pack(dir))
  await io.npm.publishTarball(dir, filename, tag)
}
