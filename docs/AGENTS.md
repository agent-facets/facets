# Docs authoring rules

These rules apply to every page under `docs/`. Changelog entries have
additional rules in `docs/changelog/AGENTS.md`.

## What each surface is for

Every page has one audience and one job. If a page starts doing a second
job, split it or link to the page that owns the other job.

| Surface | Job | Never carries |
| --- | --- | --- |
| `docs/index`, `quickstart` | Get someone productive fast | Edge cases, reference tables |
| `docs/learn/*` | Define a concept once | Command flags, install behavior |
| `guides/*` | Walk one task end to end | Exhaustive options, design rationale |
| `cli/*` | Invocation, observable output, recovery | Engine internals, spec prose |
| `specification/*` | Testable rules another implementation must satisfy | CLI choreography, our engine's architecture |
| `reference/*` | Public type and API contracts | Tutorials, rationale essays |

## One canonical home

Each behavior is documented in exactly one place. Every other mention is
a link, not a summary.

Before writing a paragraph, search for the rule. If it already exists,
link to it. Two copies of a rule become two different rules.

## Write less

- Lead with the goal, then the commands.
- Prefer a command or short example over a paragraph describing it.
- Cut any sentence that does not change what the reader types, sees, or
  decides.
- Second person, active voice. "Add a facet", not "Facets can be added".
- Length is earned by substance. A small topic gets a short page.

Do not explain why the system was designed a given way. Keep rationale
only when it prevents misuse or describes a security boundary, and keep
it to one sentence.

Do not describe internal architecture. Call orders, transaction
journals, module names, and receipt schema mechanics belong in the
source, not the docs. Users need the guarantee, not the implementation.

## Punctuation

Prose must not contain an em dash (`—`) or a spaced double hyphen used as
one (` -- `). Use a period, comma, colon, or parentheses instead.

This applies to prose only. Literal CLI flags (`--frozen-lockfile`),
code samples, and command output keep their exact characters.

**Do:** `--latest` crosses the declared range. It rewrites the specifier
minimally.

**Don't:** `--latest` crosses the declared range  --  it rewrites the
specifier minimally.

## File format

All pages use `.mdx`, so they can use Mintlify components. The only `.md`
files under `docs/` are `AGENTS.md` instruction files.

`docs.json` and internal links use extensionless paths (`/docs/learn`,
`cli/authoring/build`).

## Page descriptions

Frontmatter `description` is a short verb phrase, about 40 characters and
never much longer. Descriptions render in next/previous cards and
truncate. Drop filler like "A guide to" or "How to".

```mdx
---
title: Create Your First Facet
description: Scaffold, author, build, and verify a facet
---
```

If the scope will not fit, the page is doing too much.

## Page structure

- `##` headings mark the phases a reader can jump between.
- `<Steps>` for anything sequential.
- One idea per section. If a section branches into unrelated sub-topics,
  split it.
- Name a section for the reader's situation ("When nothing moves"), not
  for the system's internals.

## CLI command pages

Every page under `cli/` that documents a command uses this order. Skip a
section rather than moving it, and never add one just to fill the slot.

```mdx
## Usage            {/* required */}
## Examples         {/* optional */}
## Flags            {/* optional */}
## Exit codes       {/* required */}
## Output           {/* optional */}
## Details          {/* optional */}
## Troubleshooting  {/* optional */}
## See also         {/* required */}
```

What each section owns:

- **Usage** is the synopsis plus one or two sentences on what the command
  does and what it writes. There is no `What it does` section: a step
  narration of the pipeline belongs in the source, not here.
- **Examples** shows real invocations when the command takes arguments or
  more than one flag. A single zero-argument command skips it.
- **Flags** documents what `--help` does not already make obvious. One or
  two sentences each. If a flag needs more, put the detail in `Details`
  and link to it.
- **Exit codes** is a two-column table. Use the shared wording from
  [`/cli`](/cli): `0` succeeded, `1` failed in an anticipated way, `2` an
  unexpected error escaped command handling.
- **Output** describes what a successful run prints, when that helps the
  reader read or consume it.
- **Details** is the only home for command-specific explanation. Each
  topic is an `###` under it, and a topic that needs sub-topics uses
  `####`. A command page never grows a peer `##` for its own behavior.
- **Troubleshooting** is an `<AccordionGroup>` of Cause and Fix entries in
  the same shape as [Troubleshooting](/guides/troubleshooting). The
  command page owns the errors only that command can produce.
- **See also** is 2 to 4 links.

An error that several commands can produce stays in the central
troubleshooting guide. An error one command owns lives on that command's
page, and the guide links to it.

Two pages are exempt because they are not command pages: `cli/index` is a
navigation hub whose `##` headings match the nav groups, and `cli/env` is
a catalog with one `##` per variable.

Heading text is an anchor contract. Changing a heading's level is safe;
changing its words breaks every inbound link, so check before renaming.

## Linked inline code

When a link's entire visible text is code, put a backtick span inside the
Markdown link: `` [`facet build`](/cli/authoring/build) ``.

Never wrap a link in `<code>`. Mintlify applies typographic
transformation inside `<code>`, which turns `--flag` into an en dash.

## Inline code in component props

Backticks do not render inside a plain string prop. Pass a JSX expression
instead.

```mdx
<Tooltip tip={<span>Set via <code>facet login</code> or <code>FACET_TOKEN</code>.</span>}>
  personal access token
</Tooltip>
```

## Components over tables

Tables are a last resort. They wrap badly when cells hold code.

- Named things with a type and a description (fields, flags, options) use
  `<ResponseField name="…" type="…">`.
- Variants of one step (curl vs npm, local vs GitHub) use `<CodeGroup>`
  with a titled tab per variant.
- Sequential actions use `<Steps>`.

A table is fine for genuinely tabular data with short cells, such as exit
codes or environment variables. If a cell needs a long signature or
several code spans, it is not a table.

## Code blocks

Give a block a title when it names a file or a `<CodeGroup>` tab:
` ```ts src/index.ts `. Collapse blocks of roughly 15 lines or more with
` ```json expandable facets.lock `.

Show the smallest complete example. Do not enumerate every variant a
reader could construct.

## Callouts

Callouts sit beside the main path and stay short, about three lines.

- `<Tip>` for an optional shortcut.
- `<Note>` for a clarification that does not block the reader.
- `<Warning>` for a real footgun, such as data loss or a leaked secret.

Never put the primary instruction in a callout. A callout carrying five
behaviors is body text in disguise: promote it to a section.

## Tooltips

Use `<Tooltip>` on a term's first bare mention in a page, once per page.
Skip it when the surrounding prose already defines the term.

## `<Visibility>`

Guides read by both humans and agents use `<Visibility>`.

- `<Visibility for="agents">` is a short blockquote, about 20 lines at
  most. It points at `facet instructions <topic>` and gives a
  copy-pasteable command recipe. It never restates the walkthrough or a
  contract shape.
- `<Visibility for="humans">` holds the readable walkthrough.

## Cards

A card is navigation. Every `<Card>` MUST have an `href`, because a card
looks clickable whether or not it is one, and a dead card teaches the
reader to stop trying the others.

Content with no destination is not a card. Two things being contrasted
are a bold-led list; a definition is a sentence.

**Do:**

```mdx
<Card title="Quickstart" icon="rocket" href="/quickstart" horizontal>
  Install the CLI and use your first facet.
</Card>
```

**Don't:**

```mdx
<Card title="Public facets" icon="globe">
  Anyone can install a public facet.
</Card>
```

## Cross-linking

Connect pages instead of duplicating them. A guide teaches the path and
links the reference that owns the detail.

## Before you commit a page

- One audience, one job.
- Every rule stated once, elsewhere linked.
- No em dash or spaced double hyphen in prose.
- Every card has an `href`.
- No internal architecture, no design rationale beyond a preventive
  sentence.
- Claims verified against source, not against another doc page.
