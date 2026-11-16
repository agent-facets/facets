import type { RunInstallResult } from '@agent-facets/engine'
import type { CliError } from '../../util/errors.ts'
import { formatInstallFailureDetail } from '../../util/install-detail.ts'
import type { JsonResult } from '../../util/json-output.ts'
import { ensureAdapters } from './ensure-adapters.ts'
import { installFailureDetail, installFailureFix } from './install-failure.ts'

export async function jsonAdapters() {
  const errors: CliError[] = []
  const adapters = await ensureAdapters({ headless: true, report: (error) => errors.push(error) })
  return { adapters, errors }
}

export function adapterFailure(errors: CliError[]): JsonResult {
  const first = errors[0]
  return {
    ok: false,
    error: {
      code: 'ADAPTER_LOAD_FAILED',
      message: first?.what ?? 'Could not resolve adapters',
      fix: first?.fix ?? 'install an adapter and try again',
      details: { issues: errors },
    },
  }
}

export function installJsonResult(result: RunInstallResult, command: 'add' | 'install' | 'remove'): JsonResult {
  if (result.ok) return { ok: true, data: { summary: result.summary, facets: result.perFacet, mcp: result.mcp } }
  return {
    ok: false,
    error: {
      code: result.failure.code,
      message: `${command} failed`,
      details: {
        message: installFailureDetail(result.failure),
        report: formatInstallFailureDetail(result.failure, result.rollback, result.removalMigration),
        rollback: result.rollback,
      },
      fix: installFailureFix(result.failure, result.rollback, command),
    },
  }
}

/** Leave rollback to the engine before reporting an interrupted operation. */
export async function withJsonAbort<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController()
  const interrupt = () => controller.abort()
  process.on('SIGINT', interrupt)
  try {
    return await run(controller.signal)
  } finally {
    process.off('SIGINT', interrupt)
  }
}
