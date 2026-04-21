/**
 * Canonical typography for the Agent Facets brand.
 *
 * Geist (sans) for UI, Geist Mono for code/labels, Instrument Serif for
 * display italics. Matches the agentfacets.io landing page design.
 */
export const FONTS = {
  sans: 'Geist Variable',
  mono: 'Geist Mono Variable',
  serif: 'Instrument Serif',
} as const

/**
 * Ready-to-use CSS `font-family` stacks with sensible system fallbacks.
 *
 * The primary family names (`'Geist Variable'`, `'Geist Mono Variable'`)
 * match the `@font-face` family registered by `@fontsource-variable/geist`
 * and `@fontsource-variable/geist-mono`. The bare `'Geist'` / `'Geist Mono'`
 * aliases are kept as a secondary step for environments that ship a
 * self-hosted non-variable Geist under the canonical family name.
 */
export const FONT_STACKS = {
  sans: "'Geist Variable', 'Geist', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'Geist Mono Variable', 'Geist Mono', ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace",
  serif: "'Instrument Serif', ui-serif, Georgia, 'Times New Roman', serif",
} as const
