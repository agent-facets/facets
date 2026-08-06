import { describe, expect, test } from 'bun:test'
import {
  type AdapterCompatibilityFailure,
  type AdapterInstallFailure,
  type NpmVersionRequest,
  SUPPORTED_ADAPTER_APIS,
} from '@agent-facets/engine'
import {
  compatibilityFailureMessage,
  describeAdapterInstallFailure,
  describeCompatibilityFailure,
  formatPlacementWarning,
  repairCommand,
} from '../adapter-install-errors.ts'

describe('formatPlacementWarning', () => {
  test('renders the path and cause of a cleanup failure', () => {
    expect(formatPlacementWarning({ kind: 'cleanup-failed', path: '/x/gen-old', cause: 'EACCES' })).toBe(
      'warning: could not clean up /x/gen-old (EACCES)',
    )
  })
})

describe('compatibilityFailureMessage — per-adapter JSON error identity', () => {
  test('each failure maps to its own adapter name without cross-contamination', () => {
    // Substring-adjacent names ("code" ⊂ "claude-code") would mispair
    // under any .includes()-based matching; the per-failure renderer must not.
    const failures: AdapterCompatibilityFailure[] = [
      { kind: 'api-missing', adapter: 'code', supported: SUPPORTED_ADAPTER_APIS },
      { kind: 'api-unsupported', adapter: 'claude-code', found: '9.9', supported: SUPPORTED_ADAPTER_APIS },
    ]
    const rows = failures.map((failure) => ({
      message: compatibilityFailureMessage(failure),
      path: `adapters.${failure.adapter}`,
    }))
    expect(rows[0]?.path).toBe('adapters.code')
    expect(rows[0]?.message).toContain('adapter "code"')
    expect(rows[0]?.message).not.toContain('claude-code')
    expect(rows[1]?.path).toBe('adapters.claude-code')
    expect(rows[1]?.message).toContain('adapter "claude-code"')
    expect(rows[1]?.message).toContain('9.9')
  })
})

describe('describeCompatibilityFailure — the whole support set reaches the user', () => {
  test('every supported API appears in an unsupported-adapter diagnostic', () => {
    // A user staring at "supported: 0.2" when their 0.1 adapter would in
    // fact have worked is being told to do unnecessary work.
    const rendered = describeCompatibilityFailure({
      kind: 'api-unsupported',
      adapter: 'claude-code',
      found: '0.0',
      supported: SUPPORTED_ADAPTER_APIS,
    })
    for (const api of SUPPORTED_ADAPTER_APIS) {
      expect(rendered.detail).toContain(api)
    }
  })

  test('a multi-token set renders as a comma-separated list', () => {
    expect(SUPPORTED_ADAPTER_APIS.length).toBeGreaterThan(1)
    const rendered = describeCompatibilityFailure({
      kind: 'api-missing',
      adapter: 'nameless',
      supported: SUPPORTED_ADAPTER_APIS,
    })
    expect(rendered.detail).toContain(SUPPORTED_ADAPTER_APIS.join(', '))
  })

  test('a metadata mismatch between two supported tokens still lists both', () => {
    const [first, second] = SUPPORTED_ADAPTER_APIS
    if (first === undefined || second === undefined) expect.unreachable()
    const rendered = describeCompatibilityFailure({
      kind: 'api-metadata-mismatch',
      adapter: 'split-brain',
      packageDeclared: first,
      runtimeDeclared: second,
      supported: SUPPORTED_ADAPTER_APIS,
    })
    expect(rendered.detail).toContain(first)
    expect(rendered.detail).toContain(second)
  })
})

/** Build a no-compatible-release download failure for the renderer. */
function noCompatibleReleaseFailure(
  request: NpmVersionRequest,
  newestConsidered?: { version: string; declared: { kind: 'unsupported'; api: string } },
): AdapterInstallFailure {
  return {
    kind: 'download-failed',
    specifier: 'pkg',
    source: {
      kind: 'npm',
      failure: {
        ok: false,
        reason: 'no-compatible-release',
        packageName: 'pkg',
        request,
        supported: SUPPORTED_ADAPTER_APIS,
        ...(newestConsidered ? { newestConsidered } : {}),
      },
    },
  }
}

describe('describeNoCompatibleRelease — fix branches on newestConsidered', () => {
  const considered = { version: '1.0.0', declared: { kind: 'unsupported' as const, api: '9.9' } }

  test('exact + considered calls the pinned version incompatible', () => {
    const request: NpmVersionRequest = { kind: 'exact', major: 1, minor: 0, patch: 0, raw: '1.0.0' }
    const fix = describeAdapterInstallFailure(noCompatibleReleaseFailure(request, considered)).fix
    expect(fix).toContain('that exact version is incompatible')
  })

  test('exact + not considered says the version was never published', () => {
    const request: NpmVersionRequest = { kind: 'exact', major: 9, minor: 9, patch: 9, raw: '9.9.9' }
    const fix = describeAdapterInstallFailure(noCompatibleReleaseFailure(request)).fix
    expect(fix).toContain('never published')
    expect(fix).not.toContain('incompatible')
  })

  test('selector + considered blames the publisher API declaration', () => {
    const request: NpmVersionRequest = { kind: 'selector', spec: { kind: 'wildcard' }, raw: '*' }
    const fix = describeAdapterInstallFailure(noCompatibleReleaseFailure(request, considered)).fix
    expect(fix).toContain('publisher must release')
  })

  test('selector + not considered tells the user the selector matched nothing', () => {
    const request: NpmVersionRequest = { kind: 'selector', spec: { kind: 'majorWildcard', major: 5 }, raw: '5.*' }
    const fix = describeAdapterInstallFailure(noCompatibleReleaseFailure(request)).fix
    expect(fix).toContain('no stable release matches "5.*"')
    expect(fix).not.toContain('publisher must release')
  })

  test('implicit + not considered says there are no stable releases', () => {
    const request: NpmVersionRequest = { kind: 'implicit' }
    const fix = describeAdapterInstallFailure(noCompatibleReleaseFailure(request)).fix
    expect(fix).toContain('has no stable releases')
  })
})

describe('repairCommand — shell-safe specifiers', () => {
  test('renders an ordinary managed specifier unquoted', () => {
    expect(repairCommand({ kind: 'managed', specifier: 'my-adapter@1.2.3' })).toBe(
      'facet adapter install my-adapter@1.2.3',
    )
  })

  test('quotes a managed local-path specifier containing whitespace', () => {
    expect(repairCommand({ kind: 'managed', specifier: './My Adapters/tool' })).toBe(
      "facet adapter install './My Adapters/tool'",
    )
  })

  test('quotes an unmanaged name containing whitespace', () => {
    expect(repairCommand({ kind: 'unmanaged-name', name: 'weird name' })).toBe("facet adapter install 'weird name'")
  })
})

describe('describeCompatibilityFailure — install target', () => {
  test('defaults the install command to the failure adapter identity', () => {
    const described = describeCompatibilityFailure({
      kind: 'api-unsupported',
      adapter: 'future-adapter',
      found: '9.9',
      supported: SUPPORTED_ADAPTER_APIS,
    })
    expect(described.fix).toContain('facet adapter install future-adapter')
  })

  test('prefers an explicit install target over the adapter identity', () => {
    const described = describeCompatibilityFailure(
      {
        kind: 'api-missing',
        adapter: '/tmp/facet-adapter-verify-abc123/adapter.mjs',
        supported: SUPPORTED_ADAPTER_APIS,
      },
      'my-adapter',
    )
    expect(described.fix).toContain('facet adapter install my-adapter')
    expect(described.fix).not.toContain('/tmp/')
  })
})

describe('describeAdapterInstallFailure — nameless bundle verify failure', () => {
  test('fix line uses the install specifier, not the transient bundle path', () => {
    const bundlePath = '/tmp/facet-adapter-verify-abc123/adapter.mjs'
    const failure: AdapterInstallFailure = {
      kind: 'verify-failed',
      specifier: 'my-adapter',
      failure: {
        kind: 'incompatible',
        bundlePath,
        // Nameless bundle: verification falls back to the bundle path
        // as the adapter identity.
        failure: { kind: 'api-missing', adapter: bundlePath, supported: SUPPORTED_ADAPTER_APIS },
      },
    }
    const described = describeAdapterInstallFailure(failure)
    // Diagnostic identity still names the bundle the failure came from.
    expect(described.what).toContain(bundlePath)
    // The actionable command uses the user's original specifier.
    expect(described.fix).toContain('facet adapter install my-adapter')
    expect(described.fix).not.toContain(bundlePath)
  })
})
