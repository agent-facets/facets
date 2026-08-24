/**
 * The shapes update planning hands to the CLI.
 *
 * Two rules shape everything here. First, the engine answers every
 * version question once — which releases exist, which of them advance,
 * what the manifest would say afterwards — so the CLI renders a decision
 * rather than recomputing one. Second, the answers are tagged unions
 * rather than optional fields, so "a facet with no target", "a git facet
 * that was checked anyway", or "a candidate that advances nothing" are
 * not values anyone can construct.
 */

import type { FileState } from '@agent-facets/common'
import type { ManifestLoadFailure } from '../../manifest/project-files.ts'
import type { RegistryError, RegistryMetadata } from '../../registry/types.ts'
import type { AuthoredSpecifier } from './manifest-source.ts'
import type { ExactVersion } from './version-order.ts'

/**
 * One version the registry resolved for a facet, ready to be both shown
 * and installed.
 *
 * `version` is the parsed form of `metadata.version`. They are two
 * representations of one fact rather than two facts: discovery is the
 * only place a `ResolvedChoice` is built, and it refuses any response
 * whose version is not an exact `MAJOR.MINOR.PATCH`, so the pair is
 * established together at that boundary. Carrying the parsed form is
 * what lets ordering and display stay parse-free; carrying the metadata
 * is what lets application install this exact release without asking
 * the registry a second time.
 */
export interface ResolvedChoice {
  version: ExactVersion
  metadata: RegistryMetadata
}

/**
 * A registry facet whose local state is good enough to answer update
 * questions about: the manifest declares it, the lockfile records an
 * exact version, and that version satisfies what the manifest declares.
 */
export interface CheckableRegistryFacet {
  name: string
  authored: AuthoredSpecifier
  /** The installed version, read from the lockfile and never re-resolved. */
  current: ExactVersion
  /** What the authored specifier resolves to now. */
  target: ResolvedChoice
  /** What the registry's newest release is, ignoring the authored specifier. */
  latest: ResolvedChoice
}

/**
 * Which of a candidate's two choices are newer than what is installed.
 *
 * In practice Latest is never older than Target — both come from the
 * same published set, and Target is drawn from a subset of it — so
 * `range-only` should not occur. It stays representable anyway: that
 * ordering is a property of the registry's answers, not of this type,
 * and a state the registry can produce should not be one the CLI has to
 * call unreachable.
 */
export type AdvancingChoices = 'range-and-latest' | 'range-only' | 'latest-only'

/**
 * One line of the update plan.
 *
 * `candidate` and `current` split what a single "outdated?" boolean
 * would blur, and `candidate` carries which choices actually advance so
 * no caller has to re-derive it: plain update takes the rows whose range
 * advances, `--latest` takes the rows whose latest advances, and the
 * picker refuses to select a choice that is not among them.
 */
export type UpdatePlanRow =
  | { kind: 'candidate'; facet: CheckableRegistryFacet; advancing: AdvancingChoices }
  | { kind: 'current'; facet: CheckableRegistryFacet }
  | { kind: 'unsupported-source'; name: string; source: string; sourceKind: 'git' | 'local' }

/**
 * Why a registry facet could not be checked at all.
 *
 * Each of these means the project cannot answer "what is installed?"
 * from its own files, which is a question update refuses to guess at:
 * reporting such a facet as current would be a false clean report, and
 * repairing it is `facet install`'s job, not update's.
 */
export type UnusableStateReason =
  | { code: 'unparseable-source'; source: string; problem: string }
  | { code: 'missing-lock-entry' }
  | { code: 'lock-source-mismatch'; locked: 'git' | 'local' }
  | { code: 'invalid-locked-version'; version: string }
  | { code: 'locked-version-unsatisfying'; version: string; source: string }

/** A named facet together with the reason it could not be checked. */
export interface UnusableFacetState {
  name: string
  reason: UnusableStateReason
}

/**
 * Everything that can stop a plan from being produced.
 *
 * `unusable-facet-state` carries every affected facet rather than the
 * first one, so a single run tells the user the whole repair list.
 *
 * `discovery-failed` names no facet on purpose. The batch resolver
 * reports the first failure in input order — which is what makes the
 * reported error stable across runs — but it does not say which
 * specifier produced it, and a `NETWORK_ERROR` genuinely belongs to no
 * single facet. Inventing an attribution here would be a guess the user
 * could act on wrongly; the registry's own error already names the facet
 * whenever the registry knew one.
 *
 * `invalid-resolved-version` and `target-outside-range` are the registry
 * answering incoherently rather than failing: a version that is not an
 * exact release, or a Target that does not satisfy the specifier it was
 * resolved from. Both are refusals to plan against an answer that cannot
 * be true.
 *
 * `project-changed-during-discovery` exists because discovery is
 * deliberately lock-free: the files are re-read afterwards, and a plan
 * built against bytes that no longer exist is withdrawn instead of
 * offered. A re-read that fails outright surfaces as the ordinary read
 * failure for that file — it is a genuine read problem, not a race.
 */
export type PrepareFacetUpdateFailure =
  | ManifestLoadFailure
  | { reason: 'lockfile-read'; error: string }
  | { reason: 'unusable-facet-state'; facets: readonly UnusableFacetState[] }
  | { reason: 'discovery-failed'; error: RegistryError }
  | { reason: 'invalid-resolved-version'; facet: string; lookup: 'target' | 'latest'; version: string }
  | { reason: 'target-outside-range'; facet: string; source: string; version: string }
  | { reason: 'project-changed-during-discovery'; file: 'manifest' | 'lockfile' }

/**
 * A reviewed plan plus the exact project bytes it was built from.
 *
 * The snapshots are the whole reason this type exists. Preparation runs
 * without the install lock so a user can read an interactive screen
 * without blocking every other facet operation on the machine; the
 * price is that the project can change while they read. Carrying the
 * exact `FileState` of both files lets application re-check, under the
 * lock and before any mutation, that it is about to act on the same
 * project the user was shown.
 */
export interface PreparedFacetUpdate {
  projectRoot: string
  plan: readonly UpdatePlanRow[]
  manifestState: FileState
  lockfileState: FileState
}

/** Outcome of preparing an update plan. Never throws. */
export type PrepareFacetUpdateResult =
  | { ok: true; prepared: PreparedFacetUpdate }
  | { ok: false; failure: PrepareFacetUpdateFailure }
