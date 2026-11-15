## Context

The CLI already has every part this change needs. No part is connected to a command that shows a single facet.

- **Project state.** `facets.json` declares each facet and its authored specifier. `facets.lock` records the exact installed version, its source, and its canonical `integrity`. The engine loads both (`loadProjectManifest`, `loadLockfile`), and `facet list` already reads them together.
- **Installed content.** Every installed version is extracted into a cache slot at `~/.facet/cache/<name>@<version>/` (`facetCacheDir()`, `cacheGet(identity)`). A slot holds the facet's `facet.json` and every asset file (`skills/<name>/SKILL.md`, `commands/<name>.md`, `agents/<name>.md`). It also holds a `cache-integrity.json` sidecar that records one hash per file and the canonical integrity. That integrity is the same value `facets.lock` records. `auditCacheSlot` re-verifies a slot against its sidecar.
- **Registry metadata.** `GET /v0/facets/{name}/{version}` (and its scoped twin) accepts `latest` and returns `description`, `author`, `owner`, `publisher`, `published_at`, `asset_counts`, `content_integrity`, and `manifest_json` (the full published `facet.json`). The engine already calls it in `registry/resolve-metadata.ts`. That function maps only the fields that install needs.
- **Registry contents.** `GET /v0/facets/{name}/{version}/contents` returns every verified file of a version except the manifest. Each text file includes its UTF-8 content. The route is in the generated contract (`registry/generated/registry-api.ts`) but the engine does not call it yet.
- **Update decision** (not used in v1, see D3). `facet outdated` is `facet update --dry-run --interactive=false`. Discovery is `discoverUpdates({ facets, lockfile })` in `engine/src/install/update/discover.ts`. Each facet becomes an `UpdatePlanRow`: `candidate` or `current` (with `current`, `target`, `latest`), or `unsupported-source` for git and local facets.
- **Registry credentials.** Every registry read resolves its credential through `resolveRegistryCredential()` (`registry/oauth-session.ts`). The credential is an OAuth session with its own `registryOrigin`, a personal access token, or absent. A failed session is reported as `RegistryError` `AUTHENTICATION_ERROR` and never downgrades to anonymous reads. `resolve-metadata.ts` shows the pattern.
- **Lockfile `0.4`.** Each facet entry records its text assets and its MCP server inventory, each with a materialization disposition. `0.2` and `0.3` remain readable.
- **Command shape.** Each command is a `Command` in `packages/cli/src/commands/<name>/index.ts`, registered in `commands.ts`. `facet search` is the nearest model. It validates positional arguments, calls the registry through the typed client, maps registry errors with `translateEngineRegistryError`, and renders an Ink view that shows a spinner while it fetches.

## Goals / Non-Goals

**Goals:**

- One command (`facet info <name>`) that answers "what is this facet and what is in it" in one screen, and points to `facet outdated` for updates.
- One command (`facet cat <name> <asset>`) that prints the real text of a skill, command, or agent, so the user can read it before it runs.
- For an installed facet, the content shown is the content installed on this machine, and it works offline.
- An installed facet is shown with no registry request at all (D3).

**Non-Goals:**

- `--json`, `name@version` arguments, registry changes, an inline update check, and the verified publisher for installed facets (see proposal and D3).
- Printing binary supplementary files. `facet cat` refuses them and `info` shows only their size.

## Decisions

### D1. One "facet view" loader shared by both commands

Add one loader in the **engine** (`packages/engine/src/inspect/facet-view.ts`, exported through `src/index.ts`) that returns a single shape both commands use. It belongs in the engine because reading, verifying, and falling back to the registry are engine work (`packages/cli/AGENTS.md`), and the CLI only renders. Selector resolution (`inspect/selector.ts`) and text/binary classification (`inspect/classify.ts`) live beside it:

```
FacetView = {
  name, version, description?, author?,
  origin: { kind: 'installed', authored: AuthoredSpecifier, source: 'registry' | 'git' | 'local' }
        | { kind: 'registry-latest' },
  manifest: FacetManifest,             // parsed with the protocol's FacetManifestSchema
  readAsset(ref): Promise<Result<string>>  // SKILL.md / commands/*.md / agents/*.md text
}
```

`readAsset` takes a resolved facet-root-relative path: a primary asset file (`skills/<n>/SKILL.md`, `commands/<n>.md`, `agents/<n>.md`, as the `authoring__facets` spec defines them) or a declared supplementary file. It returns `{ kind: 'text', content } | { kind: 'binary', sizeBytes }`. Text and binary are told apart by the registry's rule: a file is text when it decodes as strict UTF-8 and contains no NUL byte. A file from the cache and the same file from the registry therefore always get the same classification.

`info` renders the manifest and calls no asset reads. `cat` resolves one selector against the manifest and calls `readAsset` once. Because both commands use the same loader, `facet cat` always reads the version that `facet info` shows. The spec requires this.

The loader picks a source in this order:

Unlike install's locked-hit path, a slot that fails its audit is **not evicted**. Inspecting a facet must not change what the next install sees. A **local** source has no cache slot, and install reads it from its directory, so the loader reads it from `resolve(projectRoot, source.path)` as `from: 'local-path'`.

1. **Installed and the cache is good.** The facet is declared in `facets.json` and has a lock entry. `cacheGet` returns a hit for the lock entry's identity. The slot's sidecar `integrity` equals the lock entry's `integrity`, and `auditCacheSlot` passes. In that case, read `facet.json` and asset files from the slot. This is the offline path.
2. **Installed, but the cache is missing, stale, or fails the audit.** Fetch metadata and contents for the **locked exact version** from the registry. Confirm that `content_integrity` equals the lock entry's `integrity` before showing anything. If they do not match, fail with an integrity error. The output still describes the installed version. For git and local sources there is no registry fallback, so the command fails with a fix that says `facet install`.
3. **Not installed, or no project.** Fetch metadata for `latest`, then fetch contents for the resolved exact version. A `cat` read fetches contents only when an asset is printed.

*Alternatives considered:*
- *Read the materialized files in the project's adapter folders (for example `.claude/skills/...`).* Rejected. There can be several adapters with different layouts, and adapters can transform the files. The cache slot holds the canonical, integrity-verified bytes that the lockfile pins.
- *Always read from the registry.* Rejected. The user asked to see what they have locally, and it must work offline.

### D2. Engine additions are small and live beside their siblings

- `registry/resolve-metadata.ts` already fetches the metadata body. Add an exported read (`fetchVersionDetails`, my call on the name) that returns the extra fields `info` needs: `description`, `author`, `published_at`, `manifest_json`, and `content_integrity`. It reuses `facetNameToRoute`, the error translation, the identity and exact-version checks of `metadataFromWire`, and the `resolveRegistryCredential()` client setup.
- Add `registry/contents.ts` with `fetchVersionContents(name, exactVersion)` on the contents route (scoped and unscoped), with the same credential resolution and error translation. It returns path → text for text files.
- The manifest from either source is parsed with `FacetManifestSchema`. Only a malformed manifest is an error. Unknown fields are ignored.

Both reads build their client through one shared `openRegistryReadClient()` (`registry/read-client.ts`), which holds the credential block extracted from `resolveRegistryMetadataBatch`. Both functions are exported through `registry/index.ts` and `src/index.ts`. That is this repository's convention: `packages/engine/AGENTS.md` makes `src/index.ts` the authoritative export list.

### D3. No side requests in v1

For an installed facet with a verified local copy, `info` and `cat` make **no registry request**. `info` prints a static pointer in place of an update check:

```
Check for updates: facet outdated
```

An inline update check was designed and prototyped, then cut from v1. As a side request it brought its own problems: a time limit tight enough not to slow `info` but loose enough for a cold connection and a sign-in refresh, stderr notes when it failed, an `--offline` escape hatch, network prompts in agent sandboxes, and the registry learning which installed facet the user was reading. Other tools treat such checks as background, cached, and silent on failure (`gh`, npm and pip self-update notices). A later version can add one, for example an opt-in `--check` that reuses `discoverUpdates` for a single facet, so its answer cannot drift from `facet outdated`.

The only registry reads are the ones that are the job itself: describing a facet that is not installed (latest version details, plus contents when `cat` prints a file), and recovering the locked version when the local copy is missing or fails its audit (D1). A failure there is an ordinary command error.

The verified publisher is shown only when the summary came from the registry, since it arrives in the same response. It is not stored locally, so installed facets show only the manifest's free-text `author`.

### D4. Output layout

Header identity: `by <author>` comes from the manifest's free-text `author` and is filtered by D7 like every other facet string. `published by @<publisher>` (or `@<org>, published by @<publisher>`) comes only from the registry response. The `@` form is reserved for registry-verified names, so a self-declared `"author": "@anthropic"` still renders as `by @anthropic`, in its own position. A publisher or owner value that does not match the registry's username or slug grammar is dropped rather than shown.

```
chrome-devtools  v1.7.3 · installed · by Agent Facets

Check for updates: facet outdated

Live Chrome inspection for coding agents. Connects the Chrome DevTools MCP server…

Skills (1)
  using-chrome-devtools   Load when a task requires observing or controlling…
                          facet cat chrome-devtools using-chrome-devtools
                          + facet cat chrome-devtools skills/using-chrome-devtools/references/live-session-safety.md
                          + facet cat chrome-devtools skills/using-chrome-devtools/references/auto-connect-setup.md

Commands (1)
  inspect-site            Inspect a website in your running Chrome session at desktop…
                          facet cat chrome-devtools inspect-site

MCP servers (1)
  chrome-devtools         stdio · npx -y chrome-devtools-mcp@1.7.0 --autoConnect …

Files (1)
  README.md               facet cat chrome-devtools README.md

WEB: https://agentfacets.io/facets/chrome-devtools
```

For a facet that is not installed, the header says `latest` instead of `installed` and adds `published by @<publisher>`, and the action line is `INSTALL: facet add <name>`. Both action lines sit in their own section under the header. The status column shows `installed as <n>` or `omitted` (D6).

- **Columns without borders.** Name, description, and status are aligned columns, like `facet update`'s plan view. Borders would cost about 10 columns that long descriptions need, and add noise when piped. One pure formatter (`commands/info/format.ts`) produces styled lines and does the wrapping itself, so terminal and piped output have the same layout. On a terminal the lines render through Ink with styles. When piped, they print as plain text at 80 columns.
- Descriptions wrap under the asset-name column and are never truncated, because the description is what the user came to read.
- A server row shows `http · <url>` or `stdio · <command> <args…>`. These are the only two transports the manifest schema allows (`protocol__schemas`). The schema has no headers. A `stdio` server's `env` values are literal and can still be sensitive, so only their names are printed: `env: API_KEY, …`.
- A `cat` hint uses the bare name unless an agent and a skill or command share that name. In that case both hints use the folder-prefixed form. Skills and commands share one namespace, so a skill and a command can never share a name.
- Skill companion files are listed under their skill as `+ facet cat <facet> <path>`. Top-level supplementary files go in a final `Files` group, each with its `cat` hint. For a summary read from the local copy, a binary file shows its size in place of a hint. A registry-read summary is not checked file by file, so `cat` reports a binary file when one is selected.
- Group headings use the terminology page's terms (`docs/specification/terminology.mdx`).

### D5. `facet cat` writes raw bytes and nothing else

`facet cat` writes no spinner, no header, and no trailing newline it did not read. When stdout is not a TTY, it writes the raw bytes, so `facet cat x y > file` reproduces the file. When stdout is a TTY, it renders the content through the terminal-safety filter (D7). Status and errors go to stderr only.

A selector follows the facet's own file layout. It resolves to one facet-root-relative path, in this order:

1. **The exact path of a declared file.** Primary asset paths are `skills/<n>/SKILL.md`, `commands/<n>.md`, and `agents/<n>.md`. Supplementary paths are top-level `files` as written, and skill `files` prefixed with `skills/<n>/`.
2. **Folder-prefixed name.** `skills/<n>`, `commands/<n>`, `agents/<n>` resolve to that asset's primary file.
3. **Bare name.** Look it up in the skill-and-command namespace and in the agent namespace. One match selects it. Two matches (an agent plus a skill or command) fail and list both folder-prefixed forms. A match only against an MCP server fails with "MCP servers have no content to print" and suggests `facet info <name>`.

These forms cannot be confused with each other. Asset names are single segments with no `/` and no `.` (`protocol__schemas`), so a bare name never looks like a path. A folder-prefixed name has no file extension, so it never equals a primary file path. Supplementary paths must not collide with primary asset paths, which the manifest schema already enforces. A selected binary file fails with "binary file" and its size, and nothing is written to stdout.

The selector always uses the publisher's (authored) name, never a project alias. The files in the facet are stored under the authored names, and the selector addresses those files.

### D6. Installed assets show their disposition

The lock entry records each text asset's materialization (`authored` or `aliased`), and `facets.json` records project overrides (`aliased` with `as`, or `omitted`), as described in `docs/specification/materialization.mdx`. For an installed facet, `info` reads these and adds a suffix to the asset's row:

- `aliased` → `installed as <effective>`. This is the name the user's tool sees, for example `/moo` and not `/cowsay`.
- `omitted` → `omitted`, dimmed. The asset is still resolved and verified, but it never reaches an adapter.
- `authored` → no suffix.

MCP servers get the same suffixes. A facet that is not installed has no dispositions.

### D7a. Website link

`info` ends with `WEB: <origin>/facets/<name>`. Scoped names keep their `@scope/name` form, which is the website's `/facets/$` splat route. This is my call: the conversation left open whether the line goes at the top or the bottom. It goes last, beside `INSTALL:`, so the action lines are together.

- **Origin.** The default is `https://agentfacets.io`, and `FACET_WEB_URL` overrides it. The value goes through the same validation as `openBrowser`'s URL check (https, no user info, no control characters). An invalid override drops the line and writes a warning to stderr.
- **A custom registry suppresses the link.** If `FACET_REGISTRY_URL` or an OAuth session's `registryOrigin` is not the default registry, and `FACET_WEB_URL` is unset, the line is left out. Otherwise a dev registry would link to production, where the facet may not exist. The registry already knows each stage's website origin, but it exposes that only as `onboarding_url` in the CLI auth config. Publishing a `web_origin` field would let the CLI drop this rule. That is a registry change and out of scope.
- **Never opened.** The CLI prints the link. `util/open-browser.ts` exists for sign-in, but `info` does not call it. A `--web` flag that opens the link is a possible follow-up.
- **Limits.** The page shows the latest version, even when `info` shows an older installed one, because the website has no per-version address. A private facet's page needs a website sign-in.

### D7. Terminal safety

Facet text is written by its publisher, and a manifest `description` is an unconstrained string. Writing it raw to a terminal lets the publisher hide text from the person reviewing it while the agent still reads it. The publisher could also forge hyperlinks (OSC 8) or, in some terminals, set the clipboard (OSC 52). Today nothing in the CLI filters facet text (`util/errors.ts` only adds its own colour codes). The rules below follow the conventions of GNU `ls` (escape and quote on a TTY, raw on a pipe) and `less` (caret notation).

- **One filter, `toTerminalSafe(text) → { text, escaped: number }`,** in `packages/cli/src/util/terminal-safe.ts`. It converts C0 controls except `\n` and `\t` to caret notation, keeping CR only as part of CRLF. DEL becomes `^?`. C1 controls (U+0080–U+009F), bidi overrides and isolates (U+202A–U+202E, U+2066–U+2069), and zero-width characters (U+200B–U+200D, U+2060, U+FEFF) become `<U+XXXX>`. The filter works on decoded code points, so a C1 control is caught in both its single-byte and its UTF-8 forms.
- **`info`** passes every facet-supplied string through the filter before it reaches Ink, on a TTY or not. `info` output is for reading and is never byte-exact.
- **`cat`** filters only when stdout is a TTY. If `escaped > 0`, it writes `note: N characters shown as escapes; redirect output for raw bytes` to stderr. The note also flags suspicious content to the reader.
- **Hints and `--path` output** quote facet-supplied arguments for POSIX shells: single quotes, with `'` written as `'\''`, and only when the argument holds anything outside `[A-Za-z0-9@%_+=:,./-]`. Asset and facet names never need quoting under their grammar. Supplementary paths can contain `;`, `$`, `&`, and backticks, so those get quoted.
- **Path containment.** A selector is looked up only in the set of paths the manifest declares (D5). Raw user input is never joined to a filesystem path. A selector that is not in the declared set fails as "not found" before any read happens.
- **`--path`** prints `<slot>/<declared path>` only from a slot that passed the D1 audit. It never opens or executes anything. Even in hints, the CLI never suggests a platform `open` command: a supplementary file can have any extension, and on macOS `open` runs `.command` and `.terminal` files.
- **Agent guidance.** The overview prompt tells agents to treat `facet info` and `facet cat` output as data to summarize for the user, not as instructions to follow. Agents should use these commands to show the user what a facet does before adding it, and should not act on its contents.

### D8. Errors are values

Every expected failure is a discriminated result that is rendered through `writeCliError` (what, detail, fix) and exits with code 1. The failures are: wrong arguments, unknown facet (fix: `facet search <name>`), registry unreachable or sign-in failed (`AUTHENTICATION_ERROR`, rendered with the existing login guidance) when no installed copy exists, an integrity mismatch on fallback (fix: `facet install`), unknown selector (detail lists the printable assets and files), ambiguous selector, server-only selector, binary file, and a malformed lockfile or manifest (same wording as `facet list`). Only unexpected exceptions exit with code 2.

## Risks / Trade-offs

- **[A cache slot can be tampered with or partly evicted]** → The slot is used only when the sidecar matches the lockfile and the audit passes. Otherwise the loader falls back to the registry and checks the content against the lockfile integrity.
- **[Two registry calls for a facet that is not installed]** (metadata, then contents for `cat`) → `info` needs only metadata. `cat` needs both, and they are small reads that the CDN caches for exact versions.
- **[Users do not see updates in `info`]** → The `Check for updates: facet outdated` line points at the command that answers it. An inline check can be added later (D3).
- **[Large descriptions make long output]** → This is accepted. The user can pipe the output to a pager.
- **[An agent reads an untrusted facet before install]** → Today an agent sees a facet's text only after installing it, so `info` and `cat` create a new route for prompt injection. The overview prompt frames the output as data for the user (D7). Prompt wording reduces this risk but cannot remove it, so the guidance tells agents to show the content to the user, not to decide by themselves.
- **[Content not installed is trusted to the same degree as `facet add`]** → With no lock entry there is no integrity value to check, so the registry's response over TLS is trusted. That is the same trust a first `facet add` places in it.
- **[Escaping hides nothing from a pipe]** → This is intended. Redirected output is raw so files can be reproduced exactly, and the consumer of the pipe chooses how to show it.

## Documentation

Article III requires these documentation updates in the same change:

- **New:** `docs/cli/info.mdx` (usage, the source rule, example output for an installed facet and a facet that is not installed, the update line, exit codes) and `docs/cli/cat.mdx` (usage, the four selector forms, printing README and companion files, piping, exit codes).
- **`docs/cli/env.mdx`:** document `FACET_WEB_URL`.
- **`docs/cli/index.mdx`:** add cards for `facet info` and `facet cat`.
- **`docs/docs.json`:** add `cli/info` and `cli/cat` to the CLI page group after `cli/search`.
- **`docs/cli/search.mdx`:** add one line that says `facet info <name>` shows the full summary of a result.
- **`packages/cli/src/prompts/overview.txt`:** tell agents to use `facet info` and `facet cat` to show the user what a facet contains before adding it, and to treat the output as data, not instructions (D7).
- **`docs/cli/cat.mdx`:** document the TTY/pipe rule, the stderr note, and `--path`.
- **`docs/changelog`:** add an entry, in the same style as the `facet outdated` entry.

No existing documentation contradicts this design. `README.md` needs no change.

## Open Questions

None.
