/**
 * First-party adapters known to the CLI. Drives the zero-adapter install
 * picker (both `facet adapter install` no-arg and `facet install` zero-
 * adapter paths) so partners see a curated list of the tools we officially
 * support in closed alpha.
 *
 * `supportsInstall: false` entries render dimmed + non-selectable in the
 * picker (Adjustment A). When an adapter flips to real I/O, set this to
 * true and the picker will start accepting selections.
 */

export interface FirstPartyAdapter {
  /** Display name (matches `adapter.name` after install). */
  name: string
  /** npm package id used as the install specifier. */
  npmPackage: string
  /** Whether this adapter has real filesystem I/O ready for alpha dogfood. */
  supportsInstall: boolean
  /** One-line note shown when the adapter is dimmed. */
  comingSoonLabel?: string
}

export const FIRST_PARTY_ADAPTERS: readonly FirstPartyAdapter[] = [
  {
    name: 'claude-code',
    npmPackage: '@agent-facets/adapter-claude-code',
    supportsInstall: true,
  },
  {
    name: 'opencode',
    npmPackage: '@agent-facets/adapter-opencode',
    supportsInstall: true,
  },
  {
    name: 'codex',
    npmPackage: '@agent-facets/adapter-codex',
    supportsInstall: false,
    comingSoonLabel: '(install support coming soon)',
  },
] as const
