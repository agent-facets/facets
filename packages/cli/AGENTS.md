# `agent-facets` (the CLI)

## What this package is

The display layer for the facet pipeline. Renders progress, prompts the
user, parses command-line arguments, formats errors, picks exit codes,
and otherwise wraps `@agent-facets/protocol` (data primitives) and
`@agent-facets/engine` (CLI workflows) in a terminal-friendly skin.

If you imagine a future where the facet pipeline ships as an Electron
app, a TUI separate from the terminal, or a language-server-style
process driven by an editor, this package is the part that gets
**replaced**, not extended. Everything durable lives in `protocol`
and `engine`.

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
  belong here, not in `engine` or `protocol`.

## What does NOT belong here

- **Any business logic.** Validation, parsing, building, installing,
  caching, integrity, registry calls — all of it lives in `engine`
  (or `protocol` for spec-defined primitives). The CLI calls into
  those packages and renders the results.
- **Filesystem mutations driven by command logic.** `engine` writes
  `facets.lock`, `facets.json`, the cache; the CLI just calls `engine`.
  The exception: writing the CLI's own log files, if any.
- **Network calls.** Registry I/O belongs in `engine`'s registry client.
- **Schema definitions.** Schemas for `facets.json`, `facet.json`,
  `facets.lock` live in `protocol`.

## Rule of thumb

Before adding a file here, ask: "Would a TUI, GUI, or RPC server need
this exact code to do its job?" If yes, it belongs in `engine` or
`protocol` — pull it out and call it from here. If the code is
intrinsically about how a terminal renders output, parses arguments,
or shows interactive prompts, it belongs in `cli`.

A useful sanity check: imagine the day `engine` gets rewritten in Rust
behind a gRPC interface. What in this package would still make sense?
Argument routing, Ink components, exit-code mapping, error formatting
— everything in `cli` should survive that rewrite by talking to the
new engine over the wire instead of as a workspace dep.

## Boundary with `protocol` and `engine`

`cli` depends on two packages for everything substantive:

- **`@agent-facets/protocol`** — data primitives that are part of the
  facet specification: schemas, integrity verifiers, content-hash
  primitives, the deterministic tar layout, front-matter encoding,
  the version-spec grammar, and the bytes-validators.
- **`@agent-facets/engine`** — CLI workflows: orchestrators, the
  install pipeline, the registry HTTP client, adapter machinery, the
  cache, scaffold, edit, self-update, source resolvers, manifest
  mutations, gzip compression, and path-based loaders that wrap
  protocol's bytes-validators.

The CLI imports wire-format types and the typed registry client
(`createRegistryClient`, `WireErrorResponse`, `WireMetadataResponse`,
etc.) via engine's public surface — never from a CLI-local codegen
output. Engine owns the snapshot, the generated module, and the
client factory; CLI consumes them through `@agent-facets/engine`
exports.

The CLI's `util/registry-errors.ts` is the bridge between engine's
`RegistryError` discriminator and the CLI's user-facing `CliError`
3-line error block. `translateEngineRegistryError(err, wireCode?)`
chooses the right CLI messaging per discriminator code, and (when
the wire envelope is available) routes through the canonical
`whatForCode` / `fixForCode` translations rather than the server's
free-form `error` text.

Direct filesystem reads (other than CLI plumbing) and direct schema
manipulation are smells — they mean we missed an API in engine or
protocol. When that happens, add the API to the right layer first,
then call it from here.

`cli` may also use `@agent-facets/common` directly for genuinely common
primitives like `atomicWriteFileSync`. But if a primitive is only
shared between engine and cli, it belongs in engine.
