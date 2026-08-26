import type { ExactVersion } from '@agent-facets/engine'
import { THEME } from '../../theme.ts'

/**
 * How far a candidate version moves from what is installed.
 *
 * `none` is its own arm rather than a null: a row showing the version
 * already installed is a real, displayable state — it is what a pinned
 * facet's Target looks like — and callers have to render it rather than
 * treat it as missing data.
 */
export type VersionChange = 'none' | 'patch' | 'minor' | 'major'

/**
 * A version split into the one component that moved and everything else.
 *
 * Only `changed` is ever highlighted. Going from `1.2.3` to `1.3.0`, the
 * digit that carries the news is the `3` in the minor position — the
 * leading `1.` is shared, and the trailing `.0` is a consequence of the
 * bump rather than part of it. Colouring from the first difference
 * onward would light up that `.0` too and overstate how much moved.
 */
export interface SplitVersion {
  /** Shared leading components, including their trailing dot. */
  prefix: string
  /** The single component that differs. Empty when nothing differs. */
  changed: string
  /** Components after the changed one, including their leading dot. */
  rest: string
}

export function classifyVersionChange(current: ExactVersion, next: ExactVersion): VersionChange {
  if (next.major !== current.major) return 'major'
  if (next.minor !== current.minor) return 'minor'
  if (next.patch !== current.patch) return 'patch'
  return 'none'
}

export function formatExactVersion(version: ExactVersion): string {
  return `${version.major}.${version.minor}.${version.patch}`
}

/**
 * Split `next` around the single component that differs from `current`.
 *
 * A version that differs nowhere is all prefix, which is what lets a
 * caller render an unchanged row with no highlight at all instead of
 * special-casing it. The three parts always reassemble into the whole
 * version, so a caller cannot render a version this function shortened.
 */
export function splitAtChange(current: ExactVersion, next: ExactVersion): SplitVersion {
  switch (classifyVersionChange(current, next)) {
    case 'major':
      return { prefix: '', changed: `${next.major}`, rest: `.${next.minor}.${next.patch}` }
    case 'minor':
      return { prefix: `${next.major}.`, changed: `${next.minor}`, rest: `.${next.patch}` }
    case 'patch':
      return { prefix: `${next.major}.${next.minor}.`, changed: `${next.patch}`, rest: '' }
    case 'none':
      return { prefix: formatExactVersion(next), changed: '', rest: '' }
  }
}

/**
 * The theme role for a change of this size, or `undefined` for none.
 *
 * Mapped onto the existing three-rung semantic scale rather than a new
 * palette: a patch is the safe one, a major is the one that can break
 * you, and minor is the middle rung that scale already exists to
 * express. Colour is never the only cue — the numbers themselves say
 * which component moved, and the chosen cell carries separate non-colour
 * emphasis.
 */
export function versionChangeColor(change: VersionChange): string | undefined {
  switch (change) {
    case 'patch':
      return THEME.success
    case 'minor':
      return THEME.caution
    case 'major':
      return THEME.warning
    case 'none':
      return undefined
  }
}

/** Everything one version cell renders, decided before any JSX exists. */
export interface VersionCellStyle extends SplitVersion {
  /** Theme role for the changed component; absent when nothing moved. */
  changedColor: string | undefined
  /** Emphasis for the chosen cell. */
  underline: boolean
  bold: boolean
  /**
   * Column padding, kept out of the styled span.
   *
   * Underlining the padding renders it as underscored blanks — a stray
   * trailing underscore the reader has to work out is not a character.
   */
  padding: string
}

/**
 * Decide how one version cell should look.
 *
 * Split out of the component because it is the whole visual contract of
 * this screen and none of it is observable from a rendered Ink frame in
 * a test: colours collapse to nothing when chalk decides the stream is
 * not a terminal, and padding vanishes into whitespace normalization.
 * As a value it can simply be asserted.
 */
export function versionCellStyle(args: {
  current: ExactVersion
  version: ExactVersion
  chosen: boolean
  pad?: number
}): VersionCellStyle {
  const { current, version, chosen, pad } = args
  const split = splitAtChange(current, version)
  const width = formatExactVersion(version).length
  return {
    ...split,
    changedColor: versionChangeColor(classifyVersionChange(current, version)),
    underline: chosen,
    bold: chosen,
    padding: pad === undefined ? '' : ' '.repeat(Math.max(0, pad - width)),
  }
}
