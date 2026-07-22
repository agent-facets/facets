import type {
  AdapterCompatibilityFailure,
  AdapterInstallFailure,
  ApiDeclarationClassification,
  BundleFailure,
  InstalledAdapterFailure,
  NpmVersionRequest,
  PlaceAdapterFailure,
  RepairSource,
  VerifyAdapterFailure,
} from '@agent-facets/engine'

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
      return describeSpecifierFailure(failure.specifier, failure.failure)
    case 'download-failed':
      return describeDownloadFailure(failure.specifier, failure.source)
    case 'bundle-failed':
      return describeBundleFailure(failure.specifier, failure.failure)
    case 'verify-failed':
      return describeVerifyFailure(failure.specifier, failure.failure)
    case 'place-failed':
      return describePlaceFailure(failure.adapter, failure.failure)
  }
}

/** Render the repair command for an installed-adapter failure. */
export function repairCommand(repair: RepairSource): string {
  switch (repair.kind) {
    case 'managed':
      return `facet adapter install ${repair.specifier}`
    case 'first-party-alias':
      return `facet adapter install ${repair.alias}`
    case 'unmanaged-name':
      return `facet adapter install ${repair.name}`
  }
}

/**
 * Sole rendering point for installed-adapter inspection failures
 * (incompatible or broken entries surfaced by fail-closed loading and
 * command preflights). Engine returns structured data; adding a variant
 * forces this switch to update.
 */
export function describeInstalledAdapterFailure(failure: InstalledAdapterFailure): {
  what: string
  detail: string
  fix: string
} {
  const repairNote =
    failure.repair.kind === 'unmanaged-name' ? ' (original install source unavailable; using the adapter name)' : ''
  const fix = `reinstall a compatible release: ${repairCommand(failure.repair)}${repairNote}`

  if (failure.kind === 'incompatible') {
    const base = describeCompatibilityFailure(failure.failure)
    return { what: base.what, detail: base.detail, fix }
  }

  switch (failure.reason.kind) {
    case 'invalid-receipt':
      return {
        what: `installed adapter "${failure.name}" has an invalid installation record`,
        detail: failure.reason.detail,
        fix,
      }
    case 'missing-active-generation':
      return {
        what: `installed adapter "${failure.name}" is missing its active bundle`,
        detail: `generation "${failure.reason.generation}" does not contain adapter.js`,
        fix,
      }
    case 'load-failed': {
      const base = describeVerifyFailure(failure.name, failure.reason.failure)
      return { what: base.what, detail: base.detail, fix }
    }
  }
}

function describeSpecifierFailure(
  specifier: string,
  failure: Extract<AdapterInstallFailure, { kind: 'specifier-invalid' }>['failure'],
): { what: string; detail: string; fix: string } {
  switch (failure.reason) {
    case 'invalid-git-url':
      return {
        what: `invalid adapter specifier "${specifier}"`,
        detail: `git URL must start with https://, http://, ssh://, or git:// — got "${failure.url}"`,
        fix: 'use a built-in adapter name, npm package, supported git URL, or local path',
      }
    case 'invalid-npm-selector':
      return {
        what: `invalid version selector "${failure.selector}" for "${failure.packageName}"`,
        detail: failure.error.what,
        fix: failure.error.fix,
      }
  }
}

function describeBundleFailure(
  specifier: string,
  failure: BundleFailure,
): { what: string; detail: string; fix: string } {
  switch (failure.kind) {
    case 'no-package-json':
      return {
        what: `adapter source for "${specifier}" has no package.json`,
        detail: `looked in ${failure.sourceDir}`,
        fix: 'point the specifier at an adapter package root',
      }
    case 'no-entry-point':
      return {
        what: `cannot determine an entry point for adapter "${specifier}"`,
        detail: `tried:\n  - ${failure.tried.join('\n  - ')}`,
        fix: 'set "exports" or "main" in package.json, or ship a prebuilt dist/index.mjs',
      }
    case 'install-failed':
      return {
        what: `failed to install dependencies for adapter "${specifier}"`,
        detail: failure.stderr,
        fix: 'verify the adapter package installs with `bun install`',
      }
    case 'build-failed':
      return {
        what: `failed to bundle adapter "${specifier}"`,
        detail: failure.errors.join('\n'),
        fix: 'verify the adapter package builds with `bun build`; ensure all imports resolve',
      }
    case 'no-output':
      return {
        what: `bundling adapter "${specifier}" produced no output`,
        detail: `Bun.build() succeeded but emitted nothing for ${failure.sourceDir}`,
        fix: 'this is unexpected; please file a bug',
      }
  }
}

function describePlaceFailure(
  adapter: string,
  failure: PlaceAdapterFailure,
): { what: string; detail: string; fix: string } {
  switch (failure.kind) {
    case 'lock-held':
      return {
        what: `another install is replacing adapter "${adapter}"`,
        detail: `replacement lock held by pid ${failure.heldByPid} (${failure.lockPath})`,
        fix: 'wait for the other install to finish and retry',
      }
    case 'stage-failed':
      return {
        what: `failed to stage adapter "${adapter}"`,
        detail: failure.cause,
        fix: 'check filesystem permissions and free space under ~/.facet/adapters/',
      }
    case 'verify-failed':
      return describeVerifyFailure(adapter, failure.failure)
    case 'name-mismatch':
      return {
        what: `staged adapter for "${adapter}" identifies as "${failure.runtimeName}"`,
        detail: 'the staged bundle changed identity between verification and activation',
        fix: 'retry the install; report this if it persists',
      }
    case 'receipt-write-failed':
      return {
        what: `failed to activate adapter "${adapter}"`,
        detail: failure.cause,
        fix: 'check filesystem permissions on ~/.facet/adapters/; the previous installation remains active',
      }
  }
}

function describeVerifyFailure(
  specifier: string,
  failure: VerifyAdapterFailure,
): { what: string; detail: string; fix: string } {
  switch (failure.kind) {
    case 'import-failed':
      return {
        what: `failed to load adapter bundle for "${specifier}"`,
        detail: failure.cause,
        fix: 'verify the adapter package builds with `bun build`; ensure all imports resolve',
      }
    case 'no-default-export':
      return {
        what: `adapter "${specifier}" has no default export`,
        detail: `the bundle at ${failure.bundlePath} must export default from defineAdapter()`,
        fix: 'rebuild the adapter so its entry point default-exports the defineAdapter() result',
      }
    case 'incompatible':
      return describeCompatibilityFailure(failure.failure)
    case 'invalid-name':
      return {
        what: `adapter "${specifier}" has an invalid or missing name`,
        detail: `the bundle at ${failure.bundlePath} must declare a non-empty string name`,
        fix: 'set a non-empty "name" in the defineAdapter() definition and rebuild',
      }
    case 'invalid-shape':
      return {
        what: `adapter "${failure.adapter}" does not implement the adapter contract`,
        detail: failure.detail,
        fix: 'rebuild the adapter with the @agent-facets/adapter SDK factory (defineAdapter)',
      }
  }
}

/**
 * Sole rendering point for the shared adapter-API compatibility failure
 * union. Engine returns structured data; adding a variant forces this
 * switch to update.
 */
export function describeCompatibilityFailure(failure: AdapterCompatibilityFailure): {
  what: string
  detail: string
  fix: string
} {
  const supported = failure.supported.join(', ')
  switch (failure.kind) {
    case 'api-missing':
      return {
        what: `adapter "${failure.adapter}" does not declare an adapter API version`,
        detail: `this CLI supports adapter API ${supported}; undeclared adapters are incompatible`,
        fix: `install a release built with a current @agent-facets/adapter SDK: facet adapter install ${failure.adapter}`,
      }
    case 'api-malformed':
      return {
        what: `adapter "${failure.adapter}" declares a malformed adapter API version`,
        detail: `found "${failure.found}"; this CLI supports adapter API ${supported}`,
        fix: `install a release with a valid API declaration: facet adapter install ${failure.adapter}`,
      }
    case 'api-unsupported':
      return {
        what: `adapter "${failure.adapter}" declares unsupported adapter API ${failure.found}`,
        detail: `this CLI supports adapter API ${supported}`,
        fix: `install a compatible release: facet adapter install ${failure.adapter}`,
      }
    case 'api-metadata-mismatch':
      return {
        what: `adapter "${failure.adapter}" package metadata disagrees with its runtime API declaration`,
        detail: `package declares ${failure.packageDeclared}, runtime declares ${failure.runtimeDeclared}; supported: ${supported}`,
        fix: 'this release is inconsistently published; report it to the adapter author and install a different version',
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
    case 'metadata-invalid':
      return {
        what: `npm registry returned unusable metadata for "${failure.packageName}"`,
        detail: failure.detail,
        fix: 'verify the package was published correctly',
      }
    case 'no-compatible-release':
      return describeNoCompatibleRelease(failure)
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

function describeNoCompatibleRelease(failure: {
  packageName: string
  request: NpmVersionRequest
  supported: readonly string[]
  newestConsidered?: { version: string; declared: ApiDeclarationClassification }
}): { what: string; detail: string; fix: string } {
  const selector = failure.request.kind === 'implicit' ? 'any version' : `selector "${failure.request.raw}"`
  const supported = failure.supported.join(', ')

  let newest: string
  if (!failure.newestConsidered) {
    newest = 'no published stable version satisfies the request'
  } else {
    const { version, declared } = failure.newestConsidered
    switch (declared.kind) {
      case 'missing':
        newest = `newest considered release ${version} declares no adapter API`
        break
      case 'malformed':
        newest = `newest considered release ${version} declares malformed adapter API "${declared.found}"`
        break
      case 'unsupported':
        newest = `newest considered release ${version} declares unsupported adapter API ${declared.api}`
        break
      case 'supported':
        // Unreachable when resolution failed, but render honestly.
        newest = `newest considered release ${version} declares adapter API ${declared.api}`
        break
    }
  }

  return {
    what: `no compatible release of "${failure.packageName}" (${selector})`,
    detail: `this CLI supports adapter API ${supported}; ${newest}`,
    fix:
      failure.request.kind === 'exact'
        ? `that exact version is incompatible; try \`facet adapter install ${failure.packageName}\` for the highest compatible release`
        : 'the publisher must release a version declaring a supported adapter API',
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
