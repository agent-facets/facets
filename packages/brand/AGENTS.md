# `@agent-facets/brand`

## What this package is

Color, theme, gradient, and font tokens. Small — under 300 lines — but
**published publicly to npm**, and its primary consumer is outside this
repository: the agentfacets.io site imports the same tokens the CLI
renders with, so the terminal and the web stay in visual lockstep.

That is the fact this file exists to convey. Nothing in the source says
it, and it changes what "safe to edit" means: renaming an exported
token is a breaking change for a consumer you cannot grep. Adding is
cheap; renaming and removing are not.

The CLI depends on this package as a **devDependency**, which works
only because `bun build --compile` inlines it into the binary.

## Token layering

Three layers, in dependency order. Do not short-circuit them.

1. **Raw** — `colors.ts`, `fonts.ts`. Literal hexes and font stacks.
   This is the only place a hex literal may appear.
2. **Semantic** — `theme.ts`. `THEME` maps meaning (`primary`,
   `success`, `warning`, `caution`, `focus`, `hint`) onto raw
   constants. Every value is a reference, never a literal, so a brand
   change propagates in one edit.
3. **Derived** — `gradient.ts`, `css.ts`. Computed from the two layers
   above.

Consumers import `THEME`. `ASSET_TYPE_COLORS` is the model to copy: it
derives from `ACCENTS_DARK` rather than restating hexes.

A semantic alias may deliberately duplicate a brand color today and
diverge later — that is the point of the layer, not redundancy.

## What belongs here

- Brand and palette constants, brightness ramps, accent sets.
- Semantic theme mappings.
- Derived gradients and the generated CSS custom-property block.
- Font families and stacks.
- Pure color math (`hexToRgb`).

## What does NOT belong here

- **Any runtime dependency.** This ships to a browser and is inlined
  into a compiled binary. It has none today; keep it that way.
- React, Ink, or any component. This package emits values, not UI.
- Filesystem access, environment reads, or anything platform-specific.
- Imports from `protocol`, `engine`, `common`, or `adapter`. Brand is a
  leaf.

## `buildTokensCss` is generated output

`css.ts` produces the CSS custom-property block from the token objects.
Never hand-write or hand-edit that string, and never let a value appear
there that is not derived from a token — its determinism is a tested
contract.
