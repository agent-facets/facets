import { describeInspectFailure } from '@agent-facets/common'
import type { FileRollbackIssue, FileTransactionFailure } from './transaction.ts'

/**
 * Human-readable renderings of transaction failures.
 *
 * Kept beside the transaction rather than in the CLI because the engine itself
 * needs them for verbose logging and for the callers that still surface a
 * single sentence. The CLI renders the structured values directly where it can
 * do better than one line.
 */

/** The path a failure is about, when it is about one. */
export function transactionFailurePath(failure: FileTransactionFailure): string | undefined {
  switch (failure.kind) {
    case 'invalid-batch':
      return failure.failures[0].path
    case 'preflight':
      return failure.issues[0].path
    case 'inspect-failed':
    case 'conflict':
    case 'verify-mismatch':
      return failure.path
    case 'operation':
      return failure.failure.path
  }
}

/** One line explaining why a batch was refused or could not complete. */
export function describeTransactionFailure(failure: FileTransactionFailure): string {
  switch (failure.kind) {
    case 'invalid-batch': {
      const first = failure.failures[0]
      switch (first.reason) {
        case 'invalid-path':
          return `${first.path} is not a usable target: ${first.detail}`
        case 'invalid-boundary':
          return `${first.boundary} is not a usable boundary: ${first.detail}`
        case 'escapes-boundary':
          return `${first.path} is outside ${first.boundary}`
        case 'duplicate-path':
          return `${first.path} is targeted twice (collides with ${first.collidesWith} by ${first.by})`
      }
      break
    }
    case 'preflight': {
      const first = failure.issues[0]
      return first.kind === 'drift'
        ? `${first.path} changed after this operation was planned`
        : describeInspectFailure(first.failure)
    }
    case 'inspect-failed':
      return describeInspectFailure(failure.failure)
    case 'conflict':
      return `${failure.path} changed between planning and writing`
    case 'verify-mismatch':
      return `${failure.path} did not hold the expected contents after being written`
    case 'operation':
      return `${failure.failure.operation} failed for ${failure.failure.path}: ${failure.failure.message}`
  }
  // Unreachable: every arm above returns. Present because the nested switch
  // on `invalid-batch` reasons breaks rather than returning.
  return 'the change could not be applied'
}

/** One line explaining why a path could not be put back. */
export function describeRollbackIssue(issue: FileRollbackIssue): string {
  switch (issue.kind) {
    case 'conflict':
      return `${issue.path} was changed by something else after this run wrote it, so it was left as it is`
    case 'inspect-failed':
      return `${issue.path} could not be inspected: ${describeInspectFailure(issue.failure)}`
    case 'restore-failed':
      return `${issue.path} could not be restored: ${issue.failure.message}`
  }
}
