# Changelog authoring rules

These rules govern how changelog entries are written and structured in
`docs/changelog/index.md`. They are distilled from [Mintlify's changelog
docs](https://www.mintlify.com/docs/create/changelogs) and [Mintlify's
five-principles guide](https://www.mintlify.com/blog/five-changelog-principles-from-best-developer-brands).

## File layout

- **Single source of truth**: all changelog content lives in
  `docs/changelog/index.md`. Never create additional per-date files (e.g.
  `2026-04-20.md`)  -- they fragment the changelog, duplicate nav entries, and
  create orphan pages.
- **One changelog tab in `docs/docs.json`**: the Changelog tab must point only
  to `changelog/index`. Do not add a second tab.
- **Frontmatter must include `rss: true`**: this surfaces the RSS-subscribe
  button on the page. Keep `title: Changelog` and a short `description`.

## Entry structure

Every entry is a Mintlify `<Update>` component:

```mdx
<Update label="YYYY-MM-DD" description="Short tagline" tags={["New Feature"]}>
  ## Section heading

  Body content…
</Update>
```

- **`label`**  -- ISO date (`YYYY-MM-DD`). Sorts naturally. Generates the
  right-sidebar TOC entry.
- **`description`**  -- a short, user-scannable tagline for the day's changes.
- **`tags`**  -- see [Tag vocabulary](#tag-vocabulary) below.

## Tag vocabulary

Tags have two independent dimensions. An entry carries one **change-type** tag
and, if the `facet` CLI itself was modified, also the `CLI` tag.

### Change type (usually one, unless release spans multiple aspects, each aspect should be it's own section)

- **`New Feature`**  -- a capability that didn't exist before (a new command, a new
  adapter, a new site, a new docs surface).
- **`Improvement`**  -- something that already existed got better: faster,
  cleaner, more flexible, or picked up additional capabilities on an existing
  surface. Use this for performance wins, UX polish, and incremental additions
  to an existing command or format.
- **`Fix`**  -- a user-visible bug fix. (No entries use this yet; reserved for
  future use.)
- **`Breaking`**  -- a change that breaks existing behavior. Use this for
  backwards-incompatible changes, removals, or deprecations.

### Surface (optional)

- **`CLI`**  -- the `facet` CLI / tooling was changed. Add this whenever an
  entry touches the CLI's commands, flags, behavior, build pipeline, archive
  format, or adapter SDK.
- **No surface tag**  -- the change is non-product (docs, landing page, site
  URLs, branding). Don't invent a `Docs` or `Site` tag  -- the absence of `CLI`
  is the signal.

### Mixed-surface days

When a single day bundles CLI and non-CLI changes into one entry, tag by the
**dominant** change. For example, if `facet add` ships on the same day as a
docs URL move, tag the combined entry `["CLI", "New Feature"]`  -- the install-URL
cleanup rides along under the CLI release.

### Examples

| Change                                                | Tags                     |
|-------------------------------------------------------|--------------------------|
| Brand-new `facet add` / `facet install` commands      | `["CLI", "New Feature"]` |
| New adapter SDK and first-party adapters              | `["CLI", "New Feature"]` |
| Faster adapter installs (existing command, now fast)  | `["CLI", "Improvement"]` |
| `.facet` archive format becomes self-contained        | `["CLI", "Improvement"]` |
| New landing page at agentfacets.io                    | `["Improvement"]`        |
| Docs moved to docs.agentfacets.io                     | `["Improvement"]`        |
| Bug fix in `facet build`                              | `["CLI", "Fix"]`         |

## One entry per day

- **Never create multiple `<Update>` blocks with the same `label`.** If more
  than one thing shipped on the same date, combine them into a single entry and
  use `##` subheadings to separate the distinct announcements within the body.
- The `description` and `tags` on a combined entry should reflect all the
  changes it contains (e.g. `description="Install pipeline and new install
  URL"`, `tags={["New Feature", "Improvement"]}`).

## Writing style

An entry should read like a release announcement, not a commit summary.

- **Succinct, not terse**. Length is earned by substance: a small change gets a
  short entry, a big day gets a long one. Don't pad, but don't over-compress
  either.
- **User-facing and descriptive**. Focus on what improved for the reader, not
  what changed in the codebase. Show _how to use_ the thing  -- command
  invocations, realistic examples, sample output where it helps.
- **Connect and reference** (Mintlify principle #3): link to CLI reference
  pages (e.g. `/cli/add`, `/cli/install`), external docs, and related
  packages. Include code blocks for new commands, install flows, or migration
  paths.
- **Only what matters** (Mintlify principle #4): include changes that affect
  the user experience. Skip internal refactors and code cleanup unless they
  have a user-visible consequence (e.g. "faster adapter installs").
- **Breaking changes**: prefix with `**Breaking:**` inline and explain what
  broke and what the user must do. Make these impossible to miss.

## Ordering

Entries are listed newest-first (descending date). When adding a new entry, it
goes at the top of the file.

## RSS considerations

- RSS feed entries contain pure Markdown only  -- components, HTML, and code
  blocks are excluded. If an entry's substance is inside a code block or
  component, add an `rss` prop with an alternative text description.
- Adding a new `<Update>` or modifying headings inside an existing one
  publishes an RSS entry. Avoid gratuitous heading edits on shipped entries.

## Checklist for a new entry

- [ ] Added to the top of `docs/changelog/index.md`.
- [ ] `label="YYYY-MM-DD"` uses today's date (or the ship date).
- [ ] No other `<Update>` in the file uses the same `label`  -- if one exists,
      merge into it instead of creating a new entry.
- [ ] `description` is a short tagline covering the full scope of the day's
      changes.
- [ ] `tags` are set: one change-type tag per section (`New Feature`, `Improvement`, or
      `Fix`) plus the `CLI` tag if the `facet` CLI itself was modified.
- [ ] Body explains the user-facing impact and shows usage (code samples,
      commands, realistic examples) where relevant.
- [ ] Links to CLI reference or docs pages where appropriate.
- [ ] No duplicate `docs/changelog/*.md` files; no second Changelog tab in
      `docs/docs.json`.
