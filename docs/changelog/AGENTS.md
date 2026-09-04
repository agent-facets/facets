# Changelog authoring rules

These rules govern entries in `docs/changelog/index.mdx`. The general
docs rules in `docs/AGENTS.md` apply too, including the punctuation rule:
no em dash and no spaced double hyphen in prose.

## File layout

- All changelog content lives in `docs/changelog/index.mdx`. Never create
  per-date files; they fragment the changelog and create orphan pages.
- The Changelog tab in `docs/docs.json` points only at `changelog/index`.
- Frontmatter keeps `title: Changelog`, a short `description`, and
  `rss: true`.

## Entry structure

```mdx
<Update label="YYYY-MM-DD" description="Short tagline" tags={["New Feature"]}>
  ## Section heading

  Body content
</Update>
```

- `label` is the ISO ship date. It sorts naturally and generates the
  sidebar entry.
- `description` is a one-line tagline covering the day's changes.
- `tags` follow the vocabulary below.

## Tags

One change-type tag per section, plus `CLI` when the `facet` CLI itself
changed.

- `New Feature`: a capability that did not exist before.
- `Improvement`: something that existed got better or gained scope.
- `Fix`: a user-visible bug fix.
- `Breaking`: backwards-incompatible change, removal, or deprecation.
- `CLI`: the CLI's commands, flags, behavior, build pipeline, archive
  format, or adapter SDK changed.

No surface tag means the change was not product-facing (docs, site,
branding). Do not invent a `Docs` or `Site` tag.

When one day bundles CLI and non-CLI work, tag by the dominant change.

## One entry per day

Never write two `<Update>` blocks with the same `label`. Combine same-day
changes into one entry and separate announcements with `##` subheadings.

Entries are newest first. A new entry goes at the top of the file.

## Writing style

An entry reads like a release announcement, not a commit summary.

- Say what improved for the reader, not what changed in the codebase.
- Show usage: the command, a realistic example, sample output when it
  helps.
- Link to the pages that own the detail, such as `/cli/add` or
  `/cli/install`. Do not restate a reference page inside an entry.
- Skip internal refactors unless they have a visible consequence.
- Keep it proportional. A small fix gets a short entry.
- Prefix a breaking change with `**Breaking:**` and say what the reader
  must do.

## RSS

RSS entries carry plain Markdown only, so components and code blocks are
dropped. When an entry's substance lives in a code block or component,
add an `rss` prop with an equivalent text description.

Publishing happens when an `<Update>` is added or its headings change.
Avoid editing headings on shipped entries.

## Checklist

- [ ] Added at the top of `docs/changelog/index.mdx`.
- [ ] `label` is the ship date and no other entry uses it.
- [ ] `description` covers the day's full scope.
- [ ] Tags set: one change type per section, plus `CLI` when applicable.
- [ ] Body shows user-facing impact and usage.
- [ ] Links to the reference pages that own the detail.
- [ ] No em dash or spaced double hyphen in prose.
