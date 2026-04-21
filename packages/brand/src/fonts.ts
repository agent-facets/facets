/**
 * Canonical typography for the Agent Facets brand.
 *
 * Geist (sans) for UI, Geist Mono for code/labels, Instrument Serif for
 * display italics. Matches the agentfacets.io landing page design.
 */
export const FONTS = {
  sans: 'Geist',
  mono: 'Geist Mono',
  serif: 'Instrument Serif',
} as const

/**
 * Ready-to-use CSS `font-family` stacks with sensible system fallbacks.
 */
export const FONT_STACKS = {
  sans: "'Geist', Inter, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'Geist Mono', ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace",
  serif: "'Instrument Serif', ui-serif, Georgia, 'Times New Roman', serif",
} as const
