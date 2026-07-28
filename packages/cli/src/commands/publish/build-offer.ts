import { render } from 'ink'
import { createElement } from 'react'
import { ConfirmPrompt } from '../../tui/components/confirm-prompt.tsx'
import { SelectPrompt } from '../../tui/components/select-prompt.tsx'

/**
 * Mount `<ConfirmPrompt>` for the publish command's build-offer
 * interactions. Two thin specializations — one for the missing-artifact
 * branch and one for the source-drift branch — over the same
 * `ConfirmPrompt` machinery the rest of the CLI uses for y/n questions.
 *
 * Caller MUST gate on `canPromptInteractively()` before calling either
 * of these. The mount is unconditional: without a raw-mode-capable stdin
 * Ink throws rather than degrading.
 *
 * Returns the user's boolean answer; the Ink unmount yields a clean
 * stdin state so a follow-up `<BuildView>` mount on the "yes" branch
 * can reclaim raw mode. `ConfirmPrompt` treats Esc/Ctrl-C as `false`
 * (cancel), matching the surrounding CLI prompts and ensuring the
 * function never throws on the user closing the prompt.
 */

/**
 * Build-offer for the missing-artifact branch.
 *
 * The default answer is `Yes` because the most common reason for a
 * missing artifact is "I forgot to build" — that user wants the build.
 * The other case (intentionally publishing nothing) is one Esc away.
 */
export async function askToBuildMissing(): Promise<boolean> {
  const state: { answer: boolean } = { answer: false }
  const instance = render(
    createElement(ConfirmPrompt, {
      question: 'No built artifact found in dist/. Build it now?',
      defaultAnswer: true,
      onAnswer: (a) => {
        state.answer = a
      },
    }),
  )
  try {
    await instance.waitUntilExit()
  } finally {
    instance.unmount()
  }
  return state.answer
}

/**
 * Build-offer for the *content-drift* branch — same name and version,
 * different manifest content. Two options: rebuild and publish the new
 * artifact, or publish the existing artifact unchanged.
 *
 * "Build new and publish" would produce an artifact with the same
 * `(name, version)` as the existing one; the registry accepts whichever
 * we upload (it has no view into the user's local edits), so both
 * choices are legitimate.
 *
 * The default answer is `Yes` because the most common reason for
 * content drift is "I edited facet.json and forgot to rebuild" —
 * that user wants the rebuild. A user who explicitly wants to ship the
 * existing artifact presses `n`.
 */
export async function askToRebuildDrifted(): Promise<boolean> {
  const state: { answer: boolean } = { answer: false }
  const instance = render(
    createElement(ConfirmPrompt, {
      question: 'Built artifact is out of date (manifest content has changed). Rebuild it now?',
      defaultAnswer: true,
      onAnswer: (a) => {
        state.answer = a
      },
    }),
  )
  try {
    await instance.waitUntilExit()
  } finally {
    instance.unmount()
  }
  return state.answer
}

/** Discriminator returned by `askIdentityDriftDecision`. */
export type IdentityDriftDecision = 'build-new' | 'ship-existing' | 'cancel'

/**
 * Build-offer for the *identity-drift* branch — the discovered artifact
 * has a different name or version than the source manifest. Three
 * options, action-first imperative form:
 *
 *   1. Build & publish <source-identity>   — build the current source,
 *      verify the freshly built artifact, upload it.
 *   2. Publish <artifact-identity>         — upload the existing artifact
 *      unchanged under its own embedded identity. The registry may
 *      reject with 409 E_VERSION_EXISTS if that identity is already
 *      published; the rejection is surfaced verbatim so the user
 *      learns the source needs a version bump.
 *   3. Cancel                              — exit non-zero without
 *      contacting the registry.
 *
 * Renders via the arrow-key `SelectPrompt` to match the
 * single-select pattern already used elsewhere in the CLI.
 *
 * Caller MUST gate on `canPromptInteractively()` before calling this —
 * the mount is unconditional.
 */
export async function askIdentityDriftDecision(
  sourceIdentity: { name: string; version: string },
  artifactIdentity: { name: string; version: string },
): Promise<IdentityDriftDecision> {
  const state: { decision: IdentityDriftDecision } = { decision: 'cancel' }
  const sourceLabel = `${sourceIdentity.name}@${sourceIdentity.version}`
  const artifactLabel = `${artifactIdentity.name}@${artifactIdentity.version}`
  const instance = render(
    createElement(SelectPrompt<IdentityDriftDecision>, {
      question: `Source is ${sourceLabel}, but built artifact is ${artifactLabel}. What now?`,
      options: [
        { label: `Build & publish ${sourceLabel} (rebuild from current source)`, value: 'build-new' },
        { label: `Publish ${artifactLabel} (the existing built artifact, as-is)`, value: 'ship-existing' },
        { label: 'Cancel', value: 'cancel' },
      ],
      onSelect: (v) => {
        state.decision = v
      },
      onCancel: () => {
        state.decision = 'cancel'
      },
    }),
  )
  try {
    await instance.waitUntilExit()
  } finally {
    instance.unmount()
  }
  return state.decision
}
