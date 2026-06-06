import type { MaterializeFailure } from './materialize.ts'
import type { RunInstallFailure } from './types.ts'

/**
 * Translate a `MaterializeFailure` (engine-internal) into the matching
 * `RunInstallFailure` code (engine-public). Each `MaterializeFailure.kind`
 * maps to exactly one `RunInstallFailure.code`; the per-adapter context
 * (adapter name, asset, cause) flows through unchanged. Centralizes the
 * mapping so both materialize call sites in `runInstall` (the install
 * branch and the drift-removal branch) route failures the same way.
 */
export function materializeFailureToRunInstall(facet: string, failure: MaterializeFailure): RunInstallFailure {
  switch (failure.kind) {
    case 'unsupported-adapter':
      return { code: 'ADAPTER_UNSUPPORTED', facet, adapter: failure.adapter }
    case 'read-failed':
      return {
        code: 'ADAPTER_READ_FAILED',
        facet,
        adapter: failure.adapter,
        asset: failure.asset,
        cause: failure.cause,
      }
    case 'install-failed':
      return {
        code: 'ADAPTER_INSTALL_FAILED',
        facet,
        adapter: failure.adapter,
        asset: failure.asset,
        cause: failure.cause,
      }
    case 'delete-failed':
      return {
        code: 'ADAPTER_DELETE_FAILED',
        facet,
        adapter: failure.adapter,
        asset: failure.asset,
        cause: failure.cause,
      }
  }
}
