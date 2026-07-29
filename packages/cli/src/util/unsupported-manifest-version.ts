import type { UnsupportedManifestVersion } from '@agent-facets/engine'
import type { CliError } from './errors.ts'

/**
 * How the CLI says "this CLI is too old to read your manifest".
 *
 * One module because the same condition reaches the user through four front
 * doors — `install`, `add`, `remove`, and `list` — across two surfaces
 * (stderr and the Ink view). Each used to carry its own wording; two of them
 * told the user to fix or delete a manifest that was not wrong.
 *
 * The failure DATA is engine's ({@link UnsupportedManifestVersion}, pure
 * fields with no prose). The words are the CLI's, and they live here.
 */

/** The `what:` line, and the Ink block's heading. */
export const UNSUPPORTED_MANIFEST_VERSION_WHAT = 'facets.json declares an unsupported manifestVersion'

/**
 * The `fix:` line. The remedy is the opposite of the one for a malformed
 * manifest: upgrade the tool rather than edit the file.
 */
export const UNSUPPORTED_MANIFEST_VERSION_FIX = 'upgrade the facet CLI to a version that understands this manifest'

/** What was found versus what this CLI understands. */
export function describeUnsupportedManifestVersion(detail: UnsupportedManifestVersion): string {
  return (
    `found ${detail.observed ?? 'a non-numeric value'}; ` +
    `this CLI supports ${detail.supported.join(', ')} and unversioned manifests`
  )
}

/** The canonical stderr error, shared by every command that can hit this. */
export function unsupportedManifestVersionError(detail: UnsupportedManifestVersion): CliError {
  return {
    what: UNSUPPORTED_MANIFEST_VERSION_WHAT,
    detail: `${detail.path}: ${describeUnsupportedManifestVersion(detail)}`,
    fix: UNSUPPORTED_MANIFEST_VERSION_FIX,
  }
}
