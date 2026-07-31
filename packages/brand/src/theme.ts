import { ACCENTS_DARK, BRAND, BRIGHTNESS, hexToRgb } from './colors.ts'

/**
 * Semantic theme — all values are references to brand constants.
 * Consumers should use THEME, not the raw color constants.
 */
export const THEME = {
  // Brand hierarchy
  primary: BRAND.purple,
  secondary: BRAND.green,
  tertiary: BRAND.coral,
  brand: BRAND.purple,
  dark: BRAND.dark,

  // Semantic aliases (can diverge from brand later)
  success: BRAND.green,
  warning: BRAND.coral,
  /**
   * The middle rung of a three-state scale, between `warning` (something
   * is wrong) and `success` (it isn't). Distinct from `warning` because a
   * red/amber/green status set needs three colors, and coral against
   * green alone cannot express "not yet settled".
   */
  caution: ACCENTS_DARK.amber,
  focus: ACCENTS_DARK.pink,

  // Text — structural
  hint: BRIGHTNESS.dim,
  keyword: BRIGHTNESS.dimmer,

  // Three-color gradient: purple → teal → coral
  gradient: [BRAND.purple, BRAND.green, BRAND.coral] as const,
  gradientRGB: [hexToRgb(BRAND.purple), hexToRgb(BRAND.green), hexToRgb(BRAND.coral)] as const,
} as const
