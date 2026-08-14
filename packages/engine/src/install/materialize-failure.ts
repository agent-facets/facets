import type { MaterializeFailure } from './materialize.ts'
import type { RunInstallFailure } from './types.ts'

/**
 * Translate a `MaterializeFailure` (engine-internal) into the matching
 * `RunInstallFailure` code (engine-public). Centralizes the mapping so both
 * materialize call sites in `runInstall` (the install branch and the
 * drift-removal branch) route failures the same way.
 */
export function materializeFailureToRunInstall(facet: string, failure: MaterializeFailure): RunInstallFailure {
  switch (failure.kind) {
    case 'unsupported-adapter':
      return { code: 'ADAPTER_UNSUPPORTED', facet, adapter: failure.adapter }
    case 'incompatible-adapter':
      return { code: 'ADAPTER_INCOMPATIBLE', failures: [failure.failure] }
    case 'plan-failed':
      // Which operation was being planned decides the remedy a user is given:
      // a failed install points at the content being written, a failed removal
      // at the file being removed.
      return failure.operation === 'install'
        ? {
            code: 'ADAPTER_INSTALL_FAILED',
            facet,
            adapter: failure.adapter,
            asset: failure.asset,
            cause: failure.cause,
          }
        : {
            code: 'ADAPTER_DELETE_FAILED',
            facet,
            adapter: failure.adapter,
            asset: failure.asset,
            cause: failure.cause,
          }
    case 'transaction-failed':
      return {
        code: 'FILESYSTEM_TRANSACTION_FAILED',
        subject: { kind: 'asset', facet, adapter: failure.adapter, asset: failure.asset },
        batch: failure.batch,
      }
    case 'takeover-cancelled':
      return {
        code: 'ASSET_TAKEOVER_CANCELLED',
        facet,
        adapter: failure.adapter,
        asset: failure.asset,
      }
  }
}
