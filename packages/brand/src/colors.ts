/**
 * Core brand colors — derived from the facet.svg icon.
 */
export const BRAND = {
  purple: '#A78BFA',
  green: '#42CDAA',
  coral: '#FA8B8D',
  dark: '#1F1F28',
} as const

/**
 * Extended palette — includes docs/marketing variants.
 */
export const PALETTE = {
  violet400: '#A78BFA',
  violet700: '#6D28D9',
  violet900: '#4C1D95',
  green: '#42CDAA',
  coral: '#FA8B8D',
  dark: '#1F1F28',
} as const

/**
 * Text brightness scale.
 */
export const BRIGHTNESS = {
  dim: '#666666',
  dimmer: '#999999',
} as const

/**
 * Canonical accent palette (dark theme) — violet / pink / sky / amber.
 * Source of truth for the agentfacets.io landing page design.
 */
export const ACCENTS_DARK = {
  violet: '#8b5cf6',
  pink: '#ec4899',
  sky: '#38bdf8',
  amber: '#fde047',
} as const

/**
 * Canonical accent palette (light theme).
 */
export const ACCENTS_LIGHT = {
  violet: '#7c3aed',
  pink: '#db2777',
  sky: '#0284c7',
  amber: '#ca8a04',
} as const

/**
 * Canonical ink/surface scale (dark theme).
 */
export const INK_DARK = {
  bg: '#0a0a12',
  bgElev: '#12121c',
  ink: '#f5f4ff',
  inkDim: '#a8a6c4',
  inkFaint: '#6a6890',
} as const

/**
 * Canonical ink/surface scale (light theme).
 */
export const INK_LIGHT = {
  bg: '#f6f4ef',
  bgElev: '#ffffff',
  ink: '#0e0e1a',
  inkDim: '#4a4861',
  inkFaint: '#8a8aa3',
} as const

/**
 * Line / divider colors (dark theme).
 */
export const LINE_DARK = {
  line: 'rgba(255,255,255,0.08)',
  lineStrong: 'rgba(255,255,255,0.16)',
} as const

/**
 * Line / divider colors (light theme).
 */
export const LINE_LIGHT = {
  line: 'rgba(10,10,30,0.09)',
  lineStrong: 'rgba(10,10,30,0.18)',
} as const

/**
 * Surface overlay colors (dark theme).
 */
export const SURFACE_DARK = {
  card: 'rgba(255,255,255,0.035)',
} as const

/**
 * Surface overlay colors (light theme).
 */
export const SURFACE_LIGHT = {
  card: 'rgba(10,10,30,0.03)',
} as const

/**
 * Parse a hex color string into an RGB tuple.
 */
export function hexToRgb(hex: string): readonly [number, number, number] {
  const h = hex.replace('#', '')
  return [parseInt(h.substring(0, 2), 16), parseInt(h.substring(2, 4), 16), parseInt(h.substring(4, 6), 16)] as const
}
