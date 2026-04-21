import {
  ACCENTS_DARK,
  ACCENTS_LIGHT,
  INK_DARK,
  INK_LIGHT,
  LINE_DARK,
  LINE_LIGHT,
  SURFACE_DARK,
  SURFACE_LIGHT,
} from './colors.ts'
import { FONT_STACKS } from './fonts.ts'

/**
 * Build the canonical design-token CSS stylesheet as a string.
 *
 * Emits a `:root` block with the dark-theme defaults and an
 * `html[data-theme="light"]` block that overrides the theme-dependent
 * custom properties. Font stacks don't differ between themes, so they
 * live in `:root` only.
 *
 * This function is the single source of truth for all design tokens.
 * Consumers (the landing site today; docs / CLI splash / storybook
 * potentially later) should import and call it rather than hand-rolling
 * their own token sheet.
 */
export function buildTokensCss(): string {
  return `:root {
  --bg: ${INK_DARK.bg};
  --bg-elev: ${INK_DARK.bgElev};
  --ink: ${INK_DARK.ink};
  --ink-dim: ${INK_DARK.inkDim};
  --ink-faint: ${INK_DARK.inkFaint};
  --line: ${LINE_DARK.line};
  --line-strong: ${LINE_DARK.lineStrong};
  --card: ${SURFACE_DARK.card};
  --accent-a: ${ACCENTS_DARK.violet};
  --accent-b: ${ACCENTS_DARK.pink};
  --accent-c: ${ACCENTS_DARK.sky};
  --accent-d: ${ACCENTS_DARK.amber};
  --sans: ${FONT_STACKS.sans};
  --mono: ${FONT_STACKS.mono};
  --serif: ${FONT_STACKS.serif};
}

html[data-theme="light"] {
  --bg: ${INK_LIGHT.bg};
  --bg-elev: ${INK_LIGHT.bgElev};
  --ink: ${INK_LIGHT.ink};
  --ink-dim: ${INK_LIGHT.inkDim};
  --ink-faint: ${INK_LIGHT.inkFaint};
  --line: ${LINE_LIGHT.line};
  --line-strong: ${LINE_LIGHT.lineStrong};
  --card: ${SURFACE_LIGHT.card};
  --accent-a: ${ACCENTS_LIGHT.violet};
  --accent-b: ${ACCENTS_LIGHT.pink};
  --accent-c: ${ACCENTS_LIGHT.sky};
  --accent-d: ${ACCENTS_LIGHT.amber};
}
`
}
