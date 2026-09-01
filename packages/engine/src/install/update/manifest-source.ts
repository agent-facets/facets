/**
 * Deriving the `facets.json` value an update commits.
 *
 * Two independent things change when a facet is updated: the exact
 * version that gets installed, and the specifier the project keeps
 * declaring. They are not the same value and must not be conflated —
 * installing `1.5.0` for an entry authored as `1.*` has to preserve
 * `1.*` in the manifest. This module owns the second one, alone, so
 * dry-run previews and real application cannot disagree about what a
 * selection would write.
 */

import type { VersionSpec } from '@agent-facets/protocol'
import { describeVersionSpec } from '../../registry/describe.ts'
import type { ExactVersion } from './version-order.ts'

/**
 * A manifest entry's declared version intent, as both the verbatim
 * string the user wrote and its parsed form.
 *
 * Both are carried because both are load-bearing: the parsed spec
 * decides how a rewrite should be shaped, while the original string is
 * what gets preserved byte-for-byte whenever the rewrite is a no-op.
 * Re-rendering an unchanged specifier from its parsed form would be a
 * silent reformat of something the user typed.
 */
export interface AuthoredSpecifier {
  source: string
  spec: VersionSpec
}

/**
 * Which of a row's two resolved versions the user picked.
 *
 * `range` is the version the authored specifier itself resolves to;
 * `latest` is the registry's newest release regardless of that
 * specifier.
 */
export type UpdateChoice = 'range' | 'latest'

/**
 * The `facets.json` value to commit for a selected update.
 *
 * Choosing `range` never rewrites anything: the authored specifier
 * already permits the selected version, so the declared intent is
 * unchanged and the original string is returned verbatim.
 *
 * Choosing `latest` may cross the authored range, so the specifier is
 * widened by the smallest edit that includes the selected version while
 * preserving how the user chose to express intent:
 *
 *   - `1.2.0`  + `2.4.1` → `2.4.1`  (a pin stays a pin, at the new version)
 *   - `1.*`    + `2.4.1` → `2.*`    (major-pinned stays major-pinned)
 *   - `1.2.*`  + `2.4.1` → `2.4.*`  (minor-pinned stays minor-pinned)
 *   - `*`      + `2.4.1` → `*`      (already floats; nothing to widen)
 *   - `latest` + `2.4.1` → `latest` (likewise, and the spelling is kept)
 *
 * The floating forms return the authored string rather than a rendered
 * one so `*` and `latest` each survive as written.
 */
export function finalManifestSource(args: {
  authored: AuthoredSpecifier
  choice: UpdateChoice
  selected: ExactVersion
}): string {
  const { authored, choice, selected } = args
  if (choice === 'range') return authored.source

  switch (authored.spec.kind) {
    case 'exact':
      return describeVersionSpec(selected)
    case 'majorWildcard':
      return describeVersionSpec({ kind: 'majorWildcard', major: selected.major })
    case 'minorWildcard':
      return describeVersionSpec({ kind: 'minorWildcard', major: selected.major, minor: selected.minor })
    case 'wildcard':
    case 'latest':
      return authored.source
  }
}
