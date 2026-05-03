import type { AdapterInstallFailure } from '@agent-facets/engine'

/**
 * Map an `AdapterInstallFailure` to the `{ what, detail, fix }` triple
 * the CLI's error-block formatter consumes. Engine returns structured
 * data; this is the CLI's sole rendering point. Adding a new variant
 * to `AdapterInstallFailure` forces the switch here to update.
 */
export function describeAdapterInstallFailure(failure: AdapterInstallFailure): {
  what: string
  detail: string
  fix: string
} {
  switch (failure.kind) {
    case 'specifier-invalid':
      return {
        what: `invalid adapter specifier "${failure.specifier}"`,
        detail: `git URL must start with https://, http://, ssh://, or git:// — got "${failure.failure.url}"`,
        fix: 'use a built-in adapter name, npm package, supported git URL, or local path',
      }
    case 'download-failed':
      return describeDownloadFailure(failure.specifier, failure.source)
    case 'bundle-failed':
      return {
        what: `failed to bundle adapter "${failure.specifier}"`,
        detail: failure.cause,
        fix: 'verify the adapter package builds with `bun build`; ensure all imports resolve',
      }
    case 'verify-failed':
      return {
        what: `failed to verify adapter "${failure.specifier}"`,
        detail: failure.cause,
        fix: 'the bundled adapter did not export a valid Adapter; check the SDK version',
      }
    case 'place-failed':
      return {
        what: `failed to place adapter "${failure.adapter}"`,
        detail: failure.cause,
        fix: 'check filesystem permissions on ~/.facets/adapters/',
      }
  }
}

function describeDownloadFailure(
  specifier: string,
  source: Extract<AdapterInstallFailure, { kind: 'download-failed' }>['source'],
): { what: string; detail: string; fix: string } {
  switch (source.kind) {
    case 'npm':
      return describeNpmFailure(specifier, source.failure)
    case 'git':
      return describeGitFailure(specifier, source.failure)
    case 'local':
      return {
        what: `local adapter path "${source.failure.inputPath}" does not exist`,
        detail: 'the path is missing or does not contain a package.json',
        fix: 'verify the path exists and points at an adapter package',
      }
  }
}

function describeNpmFailure(
  _specifier: string,
  failure: Extract<AdapterInstallFailure, { kind: 'download-failed' }>['source'] extends infer S
    ? S extends { kind: 'npm'; failure: infer F }
      ? F
      : never
    : never,
): { what: string; detail: string; fix: string } {
  switch (failure.reason) {
    case 'metadata-network-error':
      return {
        what: `could not reach npm registry for "${failure.packageName}"`,
        detail: failure.cause,
        fix: 'check your network connection and retry',
      }
    case 'metadata-fetch-failed':
      return {
        what: `npm registry returned ${failure.status} for "${failure.packageName}"`,
        detail: failure.statusText,
        fix: failure.status === 404 ? 'verify the package name' : 'retry; this is usually transient',
      }
    case 'no-tarball-url':
      return {
        what: `npm registry returned no tarball URL for "${failure.packageName}"`,
        detail: 'the registry response was missing dist.tarball',
        fix: 'verify the package was published correctly',
      }
    case 'tarball-network-error':
      return {
        what: `could not download tarball for "${failure.packageName}"`,
        detail: failure.cause,
        fix: 'check your network connection and retry',
      }
    case 'tarball-fetch-failed':
      return {
        what: `tarball download for "${failure.packageName}" returned ${failure.status}`,
        detail: failure.statusText,
        fix: 'retry; this is usually transient',
      }
    case 'integrity-mismatch':
      return {
        what: `npm tarball integrity mismatch for "${failure.packageName}"`,
        detail: `${failure.algo}: expected ${failure.expected}, got ${failure.actual}`,
        fix: 'the registry or a mirror may be compromised; do not retry until you have investigated',
      }
    case 'integrity-shasum-mismatch':
      return {
        what: `npm tarball shasum mismatch for "${failure.packageName}"`,
        detail: `expected ${failure.expected}, got ${failure.actual}`,
        fix: 'the registry or a mirror may be compromised; do not retry until you have investigated',
      }
    case 'integrity-unsupported-algo':
      return {
        what: `npm tarball integrity for "${failure.packageName}" uses no supported algorithm`,
        detail: failure.integrity,
        fix: 'this is unexpected; please file a bug',
      }
    case 'integrity-missing':
      return {
        what: `npm registry returned no integrity or shasum for "${failure.packageName}"`,
        detail: 'we refuse to install untrusted bytes',
        fix: 'verify the package was published with integrity metadata',
      }
    case 'tar-slip':
      return {
        what: `npm tarball entry "${failure.entryName}" for "${failure.packageName}" escapes the extraction directory`,
        detail: 'this is a tar-slip attempt; refusing to install',
        fix: 'do not install this package; report it to the registry',
      }
  }
}

function describeGitFailure(
  specifier: string,
  failure: Extract<AdapterInstallFailure, { kind: 'download-failed' }>['source'] extends infer S
    ? S extends { kind: 'git'; failure: infer F }
      ? F
      : never
    : never,
): { what: string; detail: string; fix: string } {
  switch (failure.reason) {
    case 'git-binary-missing':
      return {
        what: `could not clone git source "${specifier}"`,
        detail: 'git is not installed (or not on PATH)',
        fix: 'install git and re-run this command',
      }
    case 'auth-required':
      return {
        what: `git authentication required for ${failure.url}`,
        detail: 'closed alpha supports public repos and SSH (via agent) only',
        fix: 'use a public URL or configure your SSH agent',
      }
    case 'clone-failed':
      return {
        what: `could not clone git source "${specifier}"`,
        detail: failure.stderr,
        fix: 'verify the URL and your network connectivity',
      }
  }
}
