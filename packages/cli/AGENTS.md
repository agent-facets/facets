# `agent-facets` (the CLI)

## What this package is

The display layer for the facet pipeline. Renders progress, prompts the
user, parses command-line arguments, formats errors, picks exit codes,
and otherwise wraps `@agent-facets/core` in a terminal-friendly skin.

If you imagine a future where the facet pipeline ships as an Electron
app, a TUI separate from the terminal, or a language-server-style
process driven by an editor, this package is the part that gets
**replaced**, not extended. Everything durable lives in `core`.

## What belongs here

- **Argument parsing and command routing.** `facet add`, `facet build`,
  `facet install`, `facet edit`, `facet create`, `facet adapter`,
  `facet help`, `facet --version`. The router and per-command flag
  declarations live here.
- **Help text and usage strings.** Per-command usage lines, options
  blocks, the global help summary.
- **Ink components and views.** `<BuildView />`, `<InstallView />`, the
  adapter picker, every spinner and progress display.
- **Interactive prompts.** Confirmation dialogs (`facet create
  --force`), adapter selection, anything that reads from stdin.
- **TTY detection and stdout/stderr separation.** Decisions like "we're
  not in a terminal, fail with a clear message" live here.
- **Error formatting.** The 3-line `error: ... fix: ...` block, the
  unknown-command suggestion logic, the exit-code mapping.
- **Smoke tests and e2e tests of the user-visible flows.** The CLI's
  test suite asserts on stdout/stderr/exit codes — those assertions
  belong here, not in `core`.

## What does NOT belong here

- **Any business logic.** Validation, parsing, building, installing,
  caching, integrity, registry calls — all of it lives in `core`. The
  CLI calls into `core` and renders the results.
- **Filesystem mutations driven by command logic.** `core` writes
  `facets.lock`, `facets.json`, the cache; the CLI just calls `core`.
  The exception: writing the CLI's own log files, if any.
- **Network calls.** Registry I/O belongs in `core`'s registry client.
- **Schema definitions.** Schemas for `facets.json`, `facet.json`,
  `facets.lock` live in `core`.

## Rule of thumb

Before adding a file here, ask: "Would a TUI, GUI, or RPC server need
this exact code to do its job?" If yes, it belongs in `core` — pull it
out and call it from here. If the code is intrinsically about how a
terminal renders output, parses arguments, or shows interactive
prompts, it belongs in `cli`.

A useful sanity check: imagine the day `core` gets rewritten in Rust
behind a gRPC interface. What in this package would still make sense?
Argument routing, Ink components, exit-code mapping, error formatting
— everything in `cli` should survive that rewrite by talking to the
new `core` over the wire instead of as a workspace dep.

## Boundary with `core`

`cli` depends on `@agent-facets/core` for everything substantive.
Direct filesystem reads (other than CLI plumbing) and direct schema
manipulation are smells — they mean we missed an API in `core`. When
that happens, add the API to `core` first, then call it from here.

`cli` may also use `@agent-facets/common` directly for genuinely common
primitives like `atomicWriteFileSync`. But if a primitive is only
shared between `core` and `cli`, it belongs in `core` (and is
re-exported if the CLI is the consumer that wants it).
