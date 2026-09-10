# `agent-facets` (the CLI)

## What this package is

The display layer for the facet pipeline: argument parsing, command
routing, Ink views, interactive prompts, error formatting, exit codes.
Everything substantive comes from `@agent-facets/protocol` (spec
primitives) and `@agent-facets/engine` (workflows).

If the pipeline ever shipped as an editor plugin or an RPC server, this
package is the part that gets **replaced**, not extended.

## What belongs here

- **Argument parsing and command routing.** `src/commands.ts` is the
  command registry and the source of truth for what `facet` can do —
  read it rather than trusting a list here.
- **Help text and usage strings.**
- **Ink components and views** (`src/tui/`) — every spinner, picker,
  progress display, and confirmation dialog.
- **TTY detection and stdout/stderr separation.**
- **Error formatting** — the `error: / detail / fix:` stderr block in
  `src/util/errors.ts`, unknown-command suggestions, exit-code mapping.
- **`src/prompts/`** — the instruction text `facet instructions` serves
  to AI agents. Despite the directory name these are *not* interactive
  prompts; they are a content asset, and the one thing in this package
  that would survive a UI rewrite intact.
- **End-to-end tests** asserting on stdout, stderr, and exit codes.

## What does NOT belong here

- **Business logic.** Validation, building, installing, caching,
  integrity — `engine`, or `protocol` for spec-defined primitives.
- **Filesystem mutations driven by command logic.** Engine writes
  `facets.lock`, `facets.json`, and the cache.
- **Registry I/O.** Engine owns the client. One exception exists today:
  `facet search` drives `createRegistryClient()` directly in
  `src/commands/search/index.ts` and validates the response shape
  inline. Treat that as known debt, not a pattern — new registry
  interactions get an engine function.
- **Schema definitions.** They live in `protocol`.

## Rule of thumb

Before adding a file here, ask: "Would a GUI or RPC server need this
exact code?" If yes, it belongs in `engine` or `protocol` — put it
there and call it from here. If it is intrinsically about a terminal,
it belongs in `cli`.

## Boundary with `protocol` and `engine`

The CLI imports wire-format types and the typed registry client through
engine's public surface, never from a CLI-local codegen output.

`src/util/registry-errors.ts` bridges engine's `RegistryError` union to
the CLI's `CliError` block. Its rule, stated at the top of the file:
the CLI is **registry-dumb**. For `REGISTRY_REJECTED` it renders the
registry's own `error`, `fix`, and `docsUrl` verbatim, with no local
code-to-message map — the registry is the single source of truth for
what an error means. The CLI authors its own text only for outcomes the
registry never describes (unparseable responses, not-found, transport
failures, caller-contract violations).

Do not reintroduce a local code-to-message map. That was deliberately
removed.

Direct filesystem reads (beyond CLI plumbing) and direct schema
manipulation are smells — they mean an API is missing a layer down.

`cli` may import `@agent-facets/common` for genuinely shared primitives
(`NonEmptyArray`, `isNonEmpty`, `AssetType`, `Scope`). If a primitive
is shared only between engine and cli, it belongs in engine.

## Ink and terminal rendering

React here means **Ink**, rendering to a terminal. There is no DOM, no
CSS, no bundler, no browser. Ignore any web-React instinct: no
`className`, no `react-dom`, no event handlers on elements. Layout is
flexbox props on `<Box>`; styling is props on `<Text>`; input is
`useInput`.

Ordinary React rules still apply — hook ordering and dependency arrays,
keys in mapped lists, functional `setState`, effect cleanup, context for
cross-cutting state. What follows is the part React knowledge does not
cover.

### Mounting and unmounting

- A mount is a **command-level** concern: `render()`, then
  `await waitUntilExit()`, then `unmount()` in a `finally`. See
  `src/commands/update/run-picker.ts` and
  `src/commands/adapter/pick-and-install.ts`.
- Call `clear()` before `unmount()` when the final frame must not
  persist above whatever renders next.
- **Gate every mount** on `canPromptInteractively()` or
  `canRenderLiveOutput()` from `src/util/interactive.ts`. Never check
  `stdout.isTTY` directly: `useInput` calls `setRawMode`, which throws
  on a non-TTY stdin.
- Pass `{ exitOnCtrlC: false }` whenever the mount holds a resource — a
  project lock, an open journal, a pending resolver. Ink's built-in
  handler exits without letting anything settle.
- Launching an external editor requires unmount → run → re-mount. Ink
  owns raw mode and stdio, so a `stdio: 'inherit'` child cannot run
  under a live mount (`src/commands/create/wizard.tsx`).

### Exiting

- **Never call `exit()` in the same tick that sets failure state.**
  Park the outcome in state and exit from an effect, so React paints
  the failure before the app tears down.
- `exit()` unmounts cleanly and the command reads a captured value;
  `exit(error)` rejects `waitUntilExit()`. Structured failures use the
  former. Consequently, **never wrap `waitUntilExit()` in a bare
  `catch {}`** — that swallows genuine crashes. The reasoning is
  written out in `src/tui/views/install/install-view.tsx`.

### Inside a view

- A promise-settling resolver must settle **exactly once on every
  path**, including interrupts. Guard with a `settled` flag; an
  interrupt should answer the open prompt, not kill the process.
- A prompt owns the whole screen. Early-return the prompt component
  rather than composing it alongside a live progress display.
- Verbose logging goes to `useStderr().write()`, never `console.log` —
  otherwise it races the live region's repaint.
- Check `key.shift` **before** plain `key.tab`; terminals set both for
  Shift+Tab (`src/tui/hooks/use-navigation-keys.ts`).
- Trampolines and providers stay `.ts` and use `createElement`; only
  components are `.tsx`.
- Use a mutable box to capture a result out of an Ink callback —
  TypeScript cannot narrow through them.

### Testing Ink views

- **Never assert on raw frames.** `wrap-ansi` reopens SGR sequences
  mid-sentence, so `toContain('some text')` fails on correct output and
  `not.toContain(...)` passes vacuously — and whether it happens depends
  on whether the runner has a TTY. Use `stripTerminalControls`,
  `visibleTerminalText`, `contentFrame`, or `visibleContentFrame` from
  `src/__tests__/helpers/terminal-output.ts`.
- Use `withTTY` from the test helpers rather than setting
  `stdout.isTTY` by hand; it sets every fact `isInteractive` reads, so
  the two stay in lockstep.
- A stdout stub must invoke the write callback, or `waitUntilExit()`
  hangs until the runner times out.

### Theme and color

Import theme tokens through `src/tui/theme.ts` and
`src/tui/gradient.ts`, which re-export `@agent-facets/brand`. Prefer
semantic tokens (`THEME.*`) over raw brand constants, and never
hardcode a color string in a component.
