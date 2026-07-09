# Docs authoring rules

These rules apply to all documentation under `docs/` (Mintlify site). For
changelog-specific rules, see `docs/changelog/AGENTS.md`.

## File format: `.mdx`

All documentation pages use the `.mdx` extension, not `.md`. MDX lets pages
use Mintlify components (`<Steps>`, `<Tooltip>`, `<Card>`, `<Visibility>`,
etc.) freely. When creating a new page, name it `*.mdx`. The only `.md`
files under `docs/` are the `AGENTS.md` instruction files (like this one),
which are guidance for agents, not published pages.

Navigation in `docs.json` references pages **without** an extension
(`cli/authoring/build`, not `cli/authoring/build.mdx`), so renaming between
`.md` and `.mdx` never touches `docs.json`. Internal links use extensionless
paths too (`/docs/learn`, not `/docs/learn/index.md`).

## Linked inline code

When a link's visible text is inline code (a command, flag, filename, or
symbol), wrap the Markdown link in `<code>…</code>` rather than using a
code span inside the link.

Markdown's `` [`code`](url) `` renders the backtick span and the link
boundary with poor spacing (the code cell hugs the surrounding text and the
underline sits awkwardly). Wrapping the whole link in `<code>` gives the
link a clean monospace cell with correct padding.

**Do:**

```mdx
See <code>[facet build](/cli/authoring/build)</code> for the full pipeline.
```

**Don't:**

```mdx
See [`facet build`](/cli/authoring/build) for the full pipeline.
```

Notes:

- Inside `<code>…</code>`, the link text is plain (no backticks) — the
  `<code>` element already provides the monospace styling.
- This applies only when the **entire** visible link text is code. A link
  whose text is prose stays a normal Markdown link: `[the manifest](/…)`.
- Inline code that is **not** a link stays a normal backtick span
  (`` `facet.json` ``). This rule is only about links.

## Inline code inside component string props

Markdown backticks do **not** render inside a component prop that takes a
plain string (for example, `<Tooltip tip="…">`). Backticks appear
literally. When a string prop needs inline code, pass a JSX expression with
a `<span>` wrapper and `<code>` elements instead.

**Do:**

```mdx
<Tooltip tip={<span>Set via <code>facet login</code> or <code>FACET_TOKEN</code>.</span>}>
  personal access token
</Tooltip>
```

**Don't** (backticks render as literal characters):

```mdx
<Tooltip tip="Set via `facet login` or `FACET_TOKEN`.">
  personal access token
</Tooltip>
```

The same applies to any other component prop typed as a string that you
want to contain inline code (e.g. `headline`). Wrap the value in
`{<span>…</span>}` and use `<code>` for the code spans.

## Writing style

Docs should be **simple, scannable, and easy to read**. Prefer showing over
telling. A reader skimming the page should be able to follow the happy path
from the code blocks and headings alone.

- **Lead with the goal, then the steps.** Open a guide with one or two
  sentences on what the reader will end up with, then get to the commands.
- **Show, don't over-explain.** Favor a command or short example over a
  paragraph describing it. Trim background that doesn't change what the
  reader types.
- **Lean on the CLI.** When a flow can be reduced to a single command
  (e.g. headless `facet create` instead of narrating a wizard), do that.
- **Succinct, not terse.** Length is earned by substance. A small change
  gets a short section; a big one gets a longer one. Don't pad.
- **Second person, active voice.** "Add a facet", not "Facets can be added".
- **Keep prose out of the reader's way.** Reference pages carry exhaustive
  flag lists and edge cases; guides carry the path a reader actually walks.
  Link to the reference rather than duplicating it.

## Page descriptions

The frontmatter `description` must be **short** — aim for ~40 characters and
treat that as the ceiling, not a target to fill. Descriptions appear in the
"next/previous page" link cards at the bottom of pages, and anything much
longer than the example below is truncated with an ellipsis.

Write a tight verb phrase that says what the page is for:

```mdx
---
title: Create Your First Facet
description: Scaffold, author, build, and verify a facet
---
```

That example is 43 characters  -- a good ceiling. Drop filler ("A guide to
…", "How to …", "Everything about …") and trailing punctuation. If you can't
fit the scope, the page is probably doing too much  -- split it.

## Page structure

Structure a guide as a walkable path, not a flat wall of prose.

- **`<Steps>` for anything sequential.** If actions happen in order (scaffold
  → write → verify → build; sign in → build → publish), wrap them in
  `<Steps>` with a `<Step title="…">` per action. This is the default for
  procedural guides.
- **`##` headings for phases.** Group the guide into a few top-level phases a
  reader can jump between from the sidebar TOC.
- **One idea per section.** If a section starts branching into unrelated
  sub-topics, split it.

## Human vs. agent content: `<Visibility>`

Guides that both a human and an AI agent will read use the `<Visibility>`
component to serve each audience the right depth without maintaining two
pages. See [Visibility](https://www.mintlify.com/docs/components/visibility).

- `<Visibility for="agents">` — a **concise** block, rendered only in the
  Markdown (`.md`) output agents consume. It routes the agent to the
  authoritative source (usually `facet instructions <topic>`) and gives a
  short, copy-pasteable command recipe. Do not restate the whole human
  walkthrough here.
- `<Visibility for="humans">` — the full, readable walkthrough shown on the
  web.

Write the agent block as a Markdown blockquote (`>`), keep it near the top of
the page (right after the intro), and point it at the CLI's own instructions
rather than duplicating guidance.

## Prefer components over tables

**Tables are a last resort.** They wrap badly, especially when cells contain
inline code, and they read poorly on narrow viewports. Reach for a
purpose-built component first:

- **Fields, methods, options, parameters → `<ResponseField>`.** Documenting a
  set of named things each with a type and a description (an adapter contract,
  a manifest's fields, a command's flags) belongs in `<ResponseField
  name="…" type="…" required>…</ResponseField>`, one per item. This renders
  each item as a clean labeled row instead of a wrapping wall of code pills.
- **Alternative ways to do one thing → `<CodeGroup>`.** When the same step has
  several variants (install from a local dir vs. GitHub vs. by name; curl vs.
  npm vs. bun), put each in its own titled tab: ` ```sh Local directory `.
  Keep the explanatory comment inline in each tab.
- **Sequential actions → `<Steps>`** (see Page structure).

**When a table is still fine:** genuinely tabular reference data where every
row shares the same simple columns and cells are short  -- e.g. HTTP status
codes and their meanings, or an environment-variable reference. If a cell
would contain a long signature or multiple code spans, it's not a table.

## Large code blocks: `expandable`

Collapse long code blocks (roughly 15+ lines  -- a full example file, a
lockfile sample) behind a toggle by adding `expandable` after the language on
the fence, with a title. The fence info string reads:

    ```json expandable facets.lock

i.e. `<language> expandable <title>`.

Short blocks (commands, small snippets) stay expanded. Always give a code
block a title after the language when it represents a named file (info string
`ts src/index.ts`) or a `<CodeGroup>` tab (info string `sh Local directory`).

## Tooltips for glossary terms

Use `<Tooltip>` to define a domain term on its **first bare mention** in a
page  -- "facet", "adapter", "lockfile", "integrity hash", "PAT". Give it a
`headline`, a one-sentence `tip`, and (where useful) a `cta`/`href` to the
fuller reference.

- One tooltip per term per page, on first use only. Don't tooltip the same
  term repeatedly.
- Skip the tooltip when the surrounding prose already defines the term inline
  ("An adapter is the bridge between…"). Tooltips are for terms used *without*
  an inline definition.
- Remember the string-prop rule above: if the `tip` needs inline code, pass
  `tip={<span>…<code>…</code></span>}`.

## Callouts

Use callouts sparingly, for information that sits beside the main path:

- **`<Tip>`** — an optional shortcut or nicety ("prefer a guided setup? run …
  with no flags").
- **`<Note>`** — a clarification the reader should know but that doesn't block
  them.
- **`<Warning>`** — a genuine footgun (a stale `dist/` shipping in CI, a
  lingering `FACET_TOKEN` after logout).

Don't wrap the primary instruction in a callout  -- callouts are the margin,
not the main text.

## Cross-linking

Connect pages instead of duplicating them. Link to the CLI reference
(`/cli/...`), the specification, and related guides using the
`<code>[…](/url)</code>` convention for command/symbol links. A guide should
teach the path and defer exhaustive detail to the reference it links.
