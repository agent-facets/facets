# `@agent-facets/core`

## What this package is

The runtime and business logic for the facet pipeline. Everything the
CLI **does** lives here — parsing, validation, building, the install
pipeline, the cache, the integrity protocol, lockfile and manifest I/O,
the registry client. The CLI is a thin display layer on top.

Think of it this way: if tomorrow we rewrote the display layer as a
TUI, a desktop GUI, or an RPC server consumed by an editor extension,
**`core` would not change**. The same APIs, the same logic, the same
filesystem layout — just a different surface calling into them.

If we ever rewrote `core` in Rust or Go, the new `core` would expose the
same operations and the existing CLI (or any other display layer) would
talk to it via gRPC or stdio. The shape of the contract is what's
durable; the implementation language is not.

## What belongs here

- **Schemas and types** for everything on disk: `facet.json`,
  `facets.json`, `facets.lock`, `.facet` archives, build manifests,
  server manifests.
- **Parsers** for source specifiers, version specifiers, front matter,
  and any other user-authored input.
- **Validators** that check structural correctness of the above.
- **Build pipeline** — the staged process that turns a facet directory
  into a `.facet` archive: collision detection, content hashing, tar
  assembly, write-output.
- **Install pipeline** — resolution, fetch, integrity verification,
  materialization, lockfile mutation. The whole `runInstall` lives here.
- **Cache** — `~/.facets/cache/` layout, identity computation, atomic
  put, lookup. The cache is core infrastructure, not CLI infrastructure.
- **Integrity protocol** — the per-source-kind hash check pipeline.
- **Registry client** — fetching metadata, downloading and extracting
  facet archives. (Currently stubbed; the seams live here.)
- **Manifest mutations** — pure functions that rewrite `facets.json`,
  `facets.lock`, `facet.json` content given old + new state.
- **Loaders** — disk → validated structure for facet manifests, server
  manifests, lockfiles.

## What does NOT belong here

- **Display code.** No Ink, no chalk, no spinners, no `console.log` for
  user-facing output, no terminal escape codes, no stdin prompts. If
  `core` needs to surface progress, it returns structured events; the
  caller renders them.
- **CLI argument parsing or command help text.** That's the CLI's job.
- **Process-exit logic.** `core` returns results; the caller decides
  what exit code to use.
- **Direct stdout/stderr writes for diagnostics.** If a module needs to
  emit structured diagnostics, it returns them. Display layers decide
  whether to log, render, or pipe them somewhere.
- **`process.argv` reads.** Configuration comes in through function
  parameters or, where unavoidable, via environment variables documented
  on the function.
- **Anything that only makes sense in a CLI context** (e.g., TTY
  detection for interactive prompts — that's a display-layer concern).

## Rule of thumb

Before adding a file here, ask: "Would a future TUI / GUI / RPC server
need this exact code to do its job?" If yes, it belongs in `core`. If
no — if the code is intrinsically about how a terminal renders output
or how a CLI parses arguments — it belongs in `cli`.

The other tell is dependencies. If a module imports `ink`, `chalk`,
`prompts`, or anything terminal-specific, it doesn't belong in `core`.
`core` should be importable from any host: a Node CLI, a Bun script,
a Cloudflare Worker (theoretically), an Electron renderer process.

## Boundary with `common`

`core` may import `@agent-facets/common` freely. `common` carries the
primitives shared with the adapter SDK; `core` builds on top of them.
Don't move things into `common` just because both `core` and another
package use them — the test for `common` is whether the **adapter SDK**
needs them at runtime. If the adapter SDK doesn't need a primitive, it
stays in `core`.
