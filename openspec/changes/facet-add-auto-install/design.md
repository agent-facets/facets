## Context

`facet add` today is a thin manifest editor (`packages/cli/src/commands/add/index.ts`,
~120 lines). It parses a source specifier, resolves enough of the source tree
to read its `facet.json` for the `name`/`version` echo, upserts an entry in
`facets.json`, and exits with a "Run 'facet install' to materialize" hint.

`facet install` (`packages/cli/src/commands/install/index.ts`, ~485 lines) does
the real work: parse `facets.json`, load adapters with the `supportsInstall`
capability flag (or launch the picker), acquire a per-project install lock,
load the prior `facets.lock`, run a per-facet `withFacetPlan` pipeline
(parse → clone/local → `loadManifest` → `runBuildPipeline` →
`resolvePrompts` → `computeAssetList`), call `materialize()` against each
adapter through an `InstallJournal` for rollback, write the lockfile
atomically, and emit a single-line success message.

This change makes `facet add` a single-command experience that does
add + install in one go, accepts bare names via a stubbed registry client,
and simplifies the source grammar. The screenshot demo
(`Resolving … / Bundle contains … / Installing to adapters …`) is a
concrete UX target the design SHALL render with Ink.

The Ink rendering pattern, picker pattern, install journal, materialize
pipeline, lockfile guard, and adapter loader all already exist. The work
is mostly **wiring + extraction** plus **two narrow new modules** (registry
stub, source-grammar rewrite) and **one new Ink view**.

## Goals / Non-Goals

**Goals:**

- Single shared core (`runInstall()` over a list of `(facetName, specifier)`
  pairs) callable from both `facet install` and `facet add`. Identical
  resolution, build, materialize, journal, and lockfile semantics.
- New `parse-source.ts` grammar: bare-name → registry stub; `github:`
  shortcut; any `https/http/ssh/git://` URL ending in `.git` (or any
  scheme://-form URL the resolver decides to attempt); SCP-style
  `git@host:owner/repo.git`; `file:` paths. No `git+` prefix.
- New `resolve-registry.ts` module exposing `resolveFromRegistry(name)`
  with a real call seam, throwing a clear "registry not yet implemented"
  error in production. Test injection point for fixture responses.
- New Ink `AddView` component that renders the four-stage progress display
  (resolving → bundle breakdown → adapter install ticks → success line +
  "Now /<command> is available" footer when applicable).
- Atomic add: any post-resolve failure SHALL revert the `facets.json`
  edit before propagating.
- Servers declared by a facet SHALL be listed in the bundle breakdown and
  trigger an explicit warning; install SHALL otherwise succeed without
  writing server config to any adapter.
- Picker reuse for the zero-adapter case (TTY) and identical non-TTY
  failure as today (so CI behavior is unchanged).
- Hard-reject `git+https://` / `git+ssh://` with a "use the URL without
  the `git+` prefix" error. No deprecation period — pre-users.

**Non-Goals:**

- The registry server, registry API contract, registry hosting, registry
  publish/yank, and registry auth. Stub only.
- Multi-registry support, registry mirroring, or any registry-selection
  flag/env var.
- MCP server materialization, server config writes to adapters, or any
  auth flow for servers.
- Changes to `facet install`'s output, flags, or exit codes.
- A `--no-install` opt-out flag on `facet add`.

## Decisions

### D1. `runInstall()` owns the entire install transaction; both commands render via the same Ink view

`runInstall(opts: RunInstallOpts): Promise<RunInstallResult>` SHALL be
exported from `install/run-install.ts` and SHALL own, in order:

1. Acquire the advisory install lock (`acquireInstallLock`).
2. Load the prior lockfile (or empty skeleton).
3. For each `{ facetName, specifier }` entry: resolve → build →
   resolvePrompts → computeAssetList → materialize via `InstallJournal`.
4. Drift cleanup pass — facets present in the prior lockfile but absent
   from the entry list have their assets deleted from each adapter.
5. Atomic lockfile write.
6. Release the install lock.
7. On any failure between steps 3–5: journal rollback, then release the
   lock, then throw.

Stage progress SHALL be streamed to the caller via a structured
`onStage(event)` channel (`'lock-acquired' | 'resolving' |
'building' | 'materializing' | 'lockfile-writing' | 'done' |
'rolling-back'`). Verbose `[verbose] …` lines continue to flow through
the existing `onLog` channel for stderr.

`runInstall` SHALL return `RunInstallResult`:

```ts
{
  installed: Array<{
    name: string
    version: string
    assets: LockfileAssetEntry[]
    isNew: boolean        // not in prior lockfile
    wasUpdated: boolean   // in prior lockfile, integrity changed
    declaredServers: string[]  // names of MCP servers declared but not materialized
  }>
  removed: Array<{ name: string; version: string }>
  totalAssets: number
  durationMs: number
  adapters: Adapter[]
}
```

**Both `facet install` and `facet add` SHALL mount the same Ink view
(`<InstallView />`)**, stream stage events from `runInstall` into it,
and render the same success format from `RunInstallResult`. The view
component is shared; per-command differences are conditional renders
inside the view based on the result shape, not separate components.

**Differences between the two callers reduce to:**

- `facet add` parses the source arg, snapshots `facets.json`, upserts
  the new entry, then calls `runInstall` with a one-element array.
- `facet install` reads existing `facets.json` and calls `runInstall`
  with `Object.entries(facetsJson.facets)`.
- Manifest rollback (snapshot/restore of `facets.json`) is `add`-only;
  `install` never mutates `facets.json`.

**Output format SHALL follow the bun precedent:**

- **Per-facet bundle breakdown** (`Bundle contains: 4 skills, 2 commands,
  1 server (linear-mcp)`) is shown only when exactly one facet is being
  processed in this run (typical `add`; rare `install` case).
- **Aggregate `+` list** is shown otherwise: one `+ <name>@<version>`
  line per `isNew` entry, one `+ <name>@<version> (was <old-version>)`
  line per `wasUpdated` entry. Unchanged entries are not listed.
- **Single-facet success**: `1 facet installed [Xms]` followed by the
  `Now /<command> is available to your agents.` footer when the facet
  declares any commands.
- **Multi-facet success with changes**: `N facets installed[, M unchanged]
  [Xms]`. No `/command` footer (would spam for installs that touch many
  facets).
- **Multi-facet, no changes**: `Checked N facets across M adapters
  (no changes) [Xms]` — short-circuits the entire view to the summary
  line, mirroring `bun install` warm.

**Alternative considered (and rejected): keep the two flows separate and
copy logic.** Drift is the predictable failure mode — we already saw it
with the `facets`/`servers` rejection living in `withFacetPlan` and the
"unsupported source" error in `parse-source`.

**Alternative considered (and rejected): `runInstall` owns lockfile work
but each command renders independently with separate plain-text vs. Ink
output.** Rejected at user direction: Ink is the project's display
method; cheating with `console.log` in `install` would create two
inconsistent output formats for the same operation.

### D2. Source grammar, types, and resolution pipeline

#### D2.1. Tagged union for sources, no optional discriminators

`parse-source.ts` SHALL export a single `Source` tagged union and a pure,
sync `parseSource(spec): Result<Source>`. Resolution (which may do I/O)
SHALL live in a separate module.

```ts
export type Source =
  | { kind: 'git'; url: string; ref: string }
  | { kind: 'local'; path: string }
  | { kind: 'registry'; name: string; version: VersionSpec }

export type VersionSpec =
  | { kind: 'unspecified' }                                          // user typed: viper-plans
  | { kind: 'latest' }                                               // user typed: viper-plans@*
  | { kind: 'major'; major: number }                                 // user typed: viper-plans@1.*
  | { kind: 'minor'; major: number; minor: number }                  // user typed: viper-plans@1.2.*
  | { kind: 'exact'; major: number; minor: number; patch: number }   // user typed: viper-plans@1.2.3
```

Every field on every variant is non-optional. The `kind` discriminator
makes `switch` exhaustive without "can't happen" branches. `unspecified`
exists only between `parseSource` and the upsert into `facets.json` —
`facet add` rewrites it to `exact` after registry resolution, so the
on-disk forms are always one of `latest | major | minor | exact`.

For git: `ref` defaults to the literal string `'HEAD'` when the user
omits `#<ref>`, so the git resolver always has *something* to pass to
`git clone --branch` (or to resolve to default branch). `ref` is what
the user typed; the **resolved commit SHA** lives in `SourceMetadata`
(see D2.4) — not in `Source`.

This passes the type-design audit:
- No optional fields encode the variant kind (every kind discriminates
  via its own `kind` tag).
- No parallel fields with "must agree" invariants.
- No comments documenting invariants that the type fails to enforce.

#### D2.2. Source-specifier grammar

`parseSource` SHALL match the following ordered sequence (first match wins):

| #  | Pattern                                                            | Produces                                                                                                                                                     |
|----|--------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | empty                                                              | error                                                                                                                                                        |
| 2  | matches `PATH_RE` — `.`, `~/`, `/`, `\`, or `<letter>:[/\\]`       | `{ kind: 'local'; path }`                                                                                                                                    |
| 3  | `file:` prefix                                                     | strip prefix, re-evaluate against this table (so `file:./foo` becomes `./foo` and routes via row 2)                                                          |
| 4  | `github:<owner>/<repo>[#<ref>]`                                    | `{ kind: 'git'; url: 'https://github.com/<owner>/<repo>.git'; ref }` (default `'HEAD'`)                                                                      |
| 5  | matches `SCP_RE` — e.g. `git@github.com:owner/repo.git[#<ref>]`    | `{ kind: 'git'; url; ref }` (URL passed verbatim)                                                                                                            |
| 6  | scheme-allowlisted URL (`https://`, `http://`, `ssh://`, `git://`) | `{ kind: 'git'; url; ref }`                                                                                                                                  |
| 7  | `git+...://` prefix                                                | **hard error** ("the git+ prefix is no longer supported; use the URL directly, e.g. `https://github.com/owner/repo.git` or `ssh://git@host/owner/repo.git`") |
| 8  | `<name>` (no scheme, no `@`)                                       | `{ kind: 'registry'; name; version: { kind: 'unspecified' } }`                                                                                               |
| 9  | `<name>@<version>` matching the version mini-grammar below         | `{ kind: 'registry'; name; version }`                                                                                                                        |
| 10 | anything else                                                      | error                                                                                                                                                        |

**Version mini-grammar (asterisk-only).** The right side of `@` SHALL
match exactly one of:

| Form                      | Produces                                 |
|---------------------------|------------------------------------------|
| `*`                       | `{ kind: 'latest' }`                     |
| `latest`                  | `{ kind: 'latest' }`                     |
| `<MAJOR>.*`               | `{ kind: 'major', major }`               |
| `<MAJOR>.<MINOR>.*`       | `{ kind: 'minor', major, minor }`        |
| `<MAJOR>.<MINOR>.<PATCH>` | `{ kind: 'exact', major, minor, patch }` |

Anything else (including semver operators `^`, `~`, `>=`, `<`, `||`, or
ranges like `1.x`) SHALL produce a hard error: *"version range '\<input\>'
is not supported; use `*`, `latest`, `<MAJOR>.*`, `<MAJOR>.<MINOR>.*`, or an exact
`<MAJOR>.<MINOR>.<PATCH>`."* The deliberately tiny range grammar keeps
parse logic trivial (four regexes) and keeps users on the safe defaults.

**Regexes borrowed from `npm/npm-package-arg` (ISC license)** with
citation comments in the source:

```ts
// PATH_RE: npm/npm-package-arg lib/npa.js `isWindowsFile`
const PATH_RE = /^(?:[.]|~[/]|[/\\]|[a-zA-Z]:[/\\])/

// SCP_RE: npm/npm-package-arg lib/npa.js `isGit`
const SCP_RE = /^[^@]+@[^:.]+\.[^:]+:.+$/i
```

The scheme-allowlist hardening (`GIT_URL_SCHEME_RE` in today's code)
SHALL be preserved for row 6 to keep the F15 "no leading `-`" guarantee
that prevents URL-as-flag injection into `git clone`. The SCP regex
already excludes leading `-` via the `[^@]+@` anchor.

#### D2.3. Storage in `facets.json`

Storage rules differ from "preserve user input verbatim" because of the
default-to-pinned policy:

| User input | Stored in `facets.json` | Notes |
|---|---|---|
| `viper-plans` | `viper-plans@<resolved-exact>` | bare name is shorthand for "pin me to current latest"; resolver writes the exact version |
| `viper-plans@*` | `viper-plans@*` | explicit "always track latest" — preserved |
| `viper-plans@1.*` | `viper-plans@1.*` | preserved |
| `viper-plans@1.2.*` | `viper-plans@1.2.*` | preserved |
| `viper-plans@1.2.3` | `viper-plans@1.2.3` | preserved |
| `file:./foo/bar` | `./foo/bar` | strip-and-normalize; prefix is redundant given `PATH_RE` |
| `./foo/bar` | `./foo/bar` | unchanged |
| `~/foo` | `~/foo` | NOT pre-expanded; expansion happens at resolve time so `facets.json` is portable across machines |
| `github:agent-facets/viper-plans#main` | preserved verbatim | |
| `git@github.com:agent-facets/viper-plans.git` | preserved verbatim | |

Default-to-pinned mirrors `bun add`: a user who doesn't think about
versioning gets reproducible installs by default. Users who want to track
upstream movement opt in explicitly via `*` / `MAJOR.*` / `MAJOR.MINOR.*`.

`~/` home expansion at the resolver SHALL use
`path.replace(/^~(?=\/|$)/, os.homedir())`. The lookahead `(?=\/|$)`
prevents matching `~user/` (different user's home on POSIX).

#### D2.4. The resolution pipeline

A new module `resolve-source.ts` SHALL export:

```ts
interface ResolvedSource {
  /** Path inside ~/.facets/cache/. The build/materialize pipeline reads from here. */
  dir: string
  /** Content-addressed integrity of the built facet. The single inviolable invariant. */
  integrity: string
  /** Provenance — where this came from. Discriminated union; no illegal combinations. */
  metadata: SourceMetadata
}

type SourceMetadata =
  | { kind: 'git'; url: string; ref: string; commit: string }
  | { kind: 'registry'; name: string; version: string }     // exact resolved version, e.g. "1.2.3"
  | { kind: 'local'; path: string }

async function resolveSource(source: Source): Promise<ResolvedSource>
```

`ResolvedSource` is the universal staging-area handle — every source kind
produces the same shape, every downstream consumer (build, materialize,
lockfile write) reads from the same shape. There is no `cleanup` field
and no `cached` boolean: the cache is the only post-resolve home, so
there's nothing temporary to clean up and nothing to disambiguate. Every
field is non-optional.

`resolveSource` SHALL switch on `source.kind`:

```ts
switch (source.kind) {
  case 'git':      return resolveGit(source)
  case 'local':    return resolveLocal(source)
  case 'registry': return resolveRegistry(source)   // currently throws stub error (see D3)
}
```

Each branch is responsible for ensuring its content lives in the cache
at the canonical path before returning, including running the integrity
checks for that source kind (D3 enumerates the three-check protocol
for registry sources; git and local degrade naturally with fewer checks
because they make fewer independent claims).

#### D2.5. Cache layout

The cache root SHALL default to `~/.facets/cache/`, overridable via the
`FACETS_CACHE_DIR` environment variable for CI and sandbox cases.

Cache keys SHALL be:

| Source kind | Cache key |
|---|---|
| `registry` | `<name>@<version>/` (exact version; one slot per name@version, period — registry invariant) |
| `git` | `<name>@<version>/` (version from the cloned facet's `facet.json`; one slot per name@version, same invariant) |
| `local` | `<name>@local/` (one slot per local facet name; clobbered on every resolve since local is its own track and we don't accumulate iteration history) |

The cache is **trusted material** post-write. We do NOT re-hash cached
content on every install — that's performance theater for a threat
(filesystem tampering by a user who already owns the machine) we
explicitly do not defend against. We DO compare the cache's recorded
integrity against the registry metadata on every registry install (D3).

#### D2.6. Lockfile semantics

The lockfile (`facets.lock`) SHALL be committed to the repo, traveling
with `facets.json`. It is the **integrity contract** that makes
`facet install` produce bit-identical results across machines and across
time, regardless of what the registry currently considers "latest."

`facet install` SHALL:

1. Read `facets.json` AND `facets.lock`.
2. For every entry present in the lockfile: ensure the cache holds that
   exact version + integrity (downloading and verifying if cache miss),
   then materialize. **No range re-evaluation. No version drift.**
3. For entries in `facets.json` but missing from the lockfile (fresh
   project, hand-edit, etc.): resolve once per the range, pin the result
   in the lockfile, materialize.
4. For entries in the lockfile but missing from `facets.json` (drift):
   remove from lockfile, remove materialized assets.

`facet install` writes to the lockfile **only** to fill in missing
entries. It never replaces existing lockfile entries. Network resolution
of an existing lockfile entry SHALL be limited to "fetch the exact
recorded version, verify integrity matches, fail loud on mismatch."

`facet add <spec>` writes a new lockfile entry as part of the add
operation. `facet update` (out of scope for this proposal) is the only
command that re-resolves *already-locked* entries against the ranges in
`facets.json`.

#### D2.7. Alternatives considered

- *Keep the `git+` prefix forever.* Rejected — carries no information
  `git clone` doesn't already infer from the scheme.
- *Hard-reject `file:` along with `git+`.* Rejected — npm tolerates
  `file:`; strip-and-normalize costs three lines and prevents friction
  for users copying examples from npm docs.
- *Preserve `file:` verbatim in `facets.json` (bun's literal behavior).*
  Rejected — two valid storage forms means review diffs churn cosmetically
  and equality checks need normalization. Pick one canonical form.
- *Pre-expand `~/` at parse time.* Rejected — breaks portability of
  `facets.json` across machines.
- *Full semver range syntax (`^`, `~`, `>=`, `||`).* Rejected — asterisk
  syntax covers the real cases (any / major / minor / exact) with a
  fraction of the parsing surface and zero ambiguity.
- *Bare `viper-plans` means "always track latest" (parses to
  `{ kind: 'latest' }`).* Rejected — ranges can be dangerous; default
  to safe by pinning to the resolved exact version. Users who want
  upstream tracking type `@*` explicitly.
- *Use integrity hash as the cache directory disambiguator (`<name>@<version>@@@<hash>/`).*
  Rejected — implies multiple integrities per `name@version` is
  legitimate, which is exactly the invariant we refuse to support. One
  `name@version`, one integrity, full stop. Mismatch is a security
  violation, not a disambiguation case.
- *Re-hash cached content on every cache hit.* Rejected — defends
  against a threat (local filesystem tampering by a user with FS access)
  that's out of scope. The cache is trusted; the registry is not.
- *`facet install` re-resolves locked entries against ranges in
  `facets.json`.* Rejected — that's `facet update`'s job. `facet install`
  is deterministic by design; reproducibility is the lockfile's purpose.

### D3. Three-check integrity protocol; registry as a stubbed branch

#### D3.1. The registry branch in `resolveSource`

For closed-alpha, `resolveRegistry(source)` is a stubbed branch in the
single resolver. It exists structurally — the rest of the pipeline
treats it as a real source kind — but its body throws clearly until the
registry ships.

`resolve-source.ts` SHALL include a `registry` branch shaped like:

```ts
async function resolveRegistry(source: Extract<Source, { kind: 'registry' }>): Promise<ResolvedSource> {
  // Step 1: metadata lookup → { resolvedVersion, expectedIntegrity, tarballUrl }
  // TODO(registry): replace with real fetch against facets.cafe metadata API.
  const meta = await resolveRegistryMetadata(source.name, source.version)

  // Step 2: cache lookup at <name>@<resolvedVersion>/.
  const cacheDir = cachePathFor({ kind: 'registry', name: source.name, version: meta.version })
  if (await exists(cacheDir)) {
    // Check A: cached integrity vs. registry metadata.
    const cachedIntegrity = await readManifestIntegrity(cacheDir)
    if (cachedIntegrity !== meta.expectedIntegrity) {
      throw new Error(`integrity mismatch: cache has ${cachedIntegrity}, registry says ${meta.expectedIntegrity}`)
    }
    return { dir: cacheDir, integrity: cachedIntegrity, metadata: { kind: 'registry', name: source.name, version: meta.version } }
  }

  // Step 3: cache miss — download, extract to temp, verify, commit.
  // TODO(registry): replace with real download + dual-tarball extraction.
  const tempDir = await downloadAndExtractFacet(meta.tarballUrl)

  // Check B: archive's own manifest vs. registry metadata.
  const archiveIntegrity = await readManifestIntegrity(tempDir)
  if (archiveIntegrity !== meta.expectedIntegrity) {
    throw new Error(`integrity mismatch: archive manifest says ${archiveIntegrity}, registry metadata says ${meta.expectedIntegrity}`)
  }

  // Check C: computed integrity over the extracted content vs. archive's manifest.
  const computedIntegrity = await computeIntegrityOver(tempDir)
  if (computedIntegrity !== archiveIntegrity) {
    throw new Error(`integrity mismatch: computed ${computedIntegrity}, manifest claims ${archiveIntegrity}`)
  }

  // All three checks passed. Atomic rename into cache.
  await atomicRename(tempDir, cacheDir)
  return { dir: cacheDir, integrity: computedIntegrity, metadata: { kind: 'registry', name: source.name, version: meta.version } }
}
```

Two stubbed functions today, both throwing with `// TODO(registry):`
markers:

```ts
// resolve-registry-metadata.ts
async function resolveRegistryMetadata(
  name: string,
  version: VersionSpec,
): Promise<{ version: string; expectedIntegrity: string; tarballUrl: string }> {
  // TODO(registry): replace with real call to facets.cafe metadata API.
  throw new Error(
    `registry metadata API is not yet implemented (would query facets.cafe for "${name}" matching ${describeVersionSpec(version)}). ` +
    `Use github:<owner>/<repo>[#<ref>] or a full git URL until the registry ships.`,
  )
}

// download-facet-tarball.ts
async function downloadAndExtractFacet(tarballUrl: string): Promise<string> {
  // TODO(registry): replace with real .facet tarball fetch + dual-extraction:
  //   - outer tarball (uncompressed): contains a manifest descriptor + inner tarball
  //   - inner tarball (compressed): the actual facet content
  // Return the path to the extracted temp dir.
  throw new Error(`registry tarball download is not yet implemented (would fetch ${tarballUrl}).`)
}
```

When the registry ships, those two function bodies get filled in. The
surrounding three-check logic, the cache layout, the resolver wiring,
and the `Source` / `ResolvedSource` types all stay the same.

#### D3.2. Three-check protocol — what each check defends against

| Check | Compares | Defends against |
|---|---|---|
| **A** (cache vs. metadata) | `cachedIntegrity` vs. `expectedIntegrity` (registry metadata) | Registry served different metadata than last time we cached this version. Cache wins; registry is the suspicious one. Stop immediately, no download. |
| **B** (archive manifest vs. metadata) | `archiveIntegrity` (from downloaded `facet.json`) vs. `expectedIntegrity` | Registry metadata API and tarball-serving disagree. MITM, registry compromise, or split-brain registry. |
| **C** (computed vs. archive manifest) | `computedIntegrity` (hash of extracted content) vs. `archiveIntegrity` | The archive's own manifest is lying about what's inside it. Tampered tarball with intact-looking metadata. |

After all three pass and the temp dir is renamed into the cache, the
content is **trusted material**. No further hashing happens for this
cache entry — including on subsequent installs that hit the cache.

#### D3.3. How git and local degrade

Git and local sources make fewer independent claims, so they need fewer
cross-checks:

- **Git**: clone → build → compute integrity over build output. Compare
  to the manifest's recorded integrity. Single check (structurally
  Check C). On match: write to `<name>@<version>/` cache slot. Tag-move
  attacks are caught here because the rebuilt content's integrity won't
  match the cached integrity from the previous successful resolve.
- **Local**: build → compute integrity → that's the answer. No
  cross-check (local IS the source of truth for itself). Always clobber
  `<name>@local/`. Trusted by definition.

#### D3.4. Lockfile interaction

When a lockfile entry already pins `(name, version, integrity)` for a
registry source, the resolver's metadata-vs-cache check (A) implicitly
becomes a metadata-vs-lockfile check too:

1. `facet install` reads `lockfileEntry.integrity` for the entry.
2. Calls `resolveRegistryMetadata(name, exactVersionFromLock)` →
   `expectedIntegrity` from registry today.
3. If `expectedIntegrity !== lockfileEntry.integrity` → **HARD ERROR**.
   The registry is now claiming this version has a different integrity
   than what we committed to the repo. That is a security event.
4. Otherwise: cache check proceeds as in D3.1; download+verify on miss.

This is the "you locked 1.2.3 with integrity ABC, the registry now says
1.2.3 has integrity XYZ" case — caught loudly, never silently accepted.

#### D3.5. Alternatives considered

- *Hardcode a mapping from common bare names to GitHub URLs (so the
  demo "works" before the registry ships).* Rejected — that's the
  registry's job; faking it client-side would let demos ship that break
  the moment the real registry comes up.
- *Combine metadata lookup and tarball download into a single registry
  call.* Rejected — they're independent code paths in any real registry
  client (metadata is a cheap JSON GET; tarball is a CDN-served binary
  fetch). Keeping them as separate stub functions matches what the
  real implementation will look like.
- *Validate version-range syntax inside `parseSource` instead of in the
  resolver.* Already covered by D2.2 — the four range forms are part of
  parse-time validation since they're a tiny grammar; arbitrary semver
  is hard-rejected at parse time.

### D4. Servers: declared, listed, not materialized

The `servers`-rejection guard at `install/index.ts:443-447` SHALL be split
into two distinct behaviors with different rationales:

#### D4.1. `facets` composition: hard-reject

A facet declaring `facets` (i.e. composing other facets) SHALL produce a
hard error with the same shape as today's rejection. Composition is a
genuinely different feature shape — recursive resolution, transitive
lockfile entries, conflict detection between sibling facets, dependency
graph cycle detection — and warrants its own proposal. It is NOT being
treated as alpha-gated; it is being treated as out-of-scope feature work.

#### D4.2. `servers` (MCP): listed in bundle, warned, not materialized

A facet declaring `servers` SHALL succeed installation. The resolver and
build pipeline SHALL preserve the server names and pass them along; the
materialize phase SHALL NOT touch any adapter file based on server data.
The Ink view (D5) SHALL render server names in the bundle breakdown
alongside skills/agents/commands AND emit a two-line warning block
immediately below the breakdown:

```
⚠ 1 server declared (linear-mcp) — server installation not yet supported, skipping.
  See https://docs.facets.io/servers for status.
```

For N servers, the first line is pluralized (`⚠ 3 servers declared (linear-mcp, github-mcp, slack-mcp) — …`). The docs URL is a `// TODO(servers):` marker in code; the page does not yet exist and creating it is part of the implementation tasks.

The warning SHALL render only in the Ink view; it SHALL NOT also flow
through `onLog` (verbose stderr). Verbose mode is for debug noise; this
warning is a UX signal that belongs in the primary output.

#### D4.3. Lockfile interaction

Lockfile entries SHALL NOT record declared server names, server config,
or any server-related metadata. Lockfile entries describe what was
materialized; servers were not materialized. When server installation
eventually ships in a future proposal, the lockfile schema can grow at
that point with shape informed by the actual feature design — speculative
metadata fields for an undesigned feature are out of scope.

#### D4.4. Alternatives considered

- *Error on `servers` like we do on `facets`.* Rejected — the demo
  intentionally features a facet declaring Linear MCP. Refusing to
  install it would block the demo end-to-end, and the gap between
  "manifest can declare servers" and "we can install servers" is
  legitimately just a missing feature, not a soundness problem.
- *Mirror the server "list and skip" treatment for `facets` composition.*
  Rejected — servers are inert metadata (we literally don't touch them);
  composition changes the entire materialize pipeline. "List and skip"
  for composition would silently half-install facets, leaving users with
  commands they expected but didn't get. Hard error is more honest.
- *Emit the server warning via both Ink view and `onLog`.* Rejected —
  redundant; the Ink view is the canonical output and verbose mode is
  for debug-level noise, not user-facing warnings.
- *Record `serversDeclared: string[]` on the lockfile entry as informational
  metadata.* Rejected — speculative fields for unbuilt features. The
  lockfile schema can grow when server installation ships.

### D5. `facet add` flow + Ink rendering

#### D5.1. Ink instance owns the entire command lifecycle

`add/index.ts` SHALL mount a single Ink instance hosting the shared
`<InstallView />` component (D1) immediately on entry, and SHALL drive
all visible output — including errors — through that instance. The
instance is *mounted* from frame zero; the *visible* output is governed
by the view's state. States with no meaningful display (early
pre-flight, idle between picker and resolve) SHALL render as `null` so
the user sees no output until there's something worth showing.

The view's state machine:

```ts
type ViewState =
  | { phase: 'idle' }                           // mounted but nothing to show yet
  | { phase: 'resolving'; facetName: string }
  | { phase: 'resolved'; facetName: string; bundle: BundleSummary; previous?: string }
  | { phase: 'downloading'; facetName: string }
  | { phase: 'cached'; facetName: string }
  | { phase: 'materializing'; facetName: string; adapters: AdapterProgress[] }
  | { phase: 'lockfile-writing' }
  | { phase: 'done'; result: RunInstallResult }
  | { phase: 'error'; phase: string; message: string; exitCode: number }
```

Errors that occur before any visible content has been rendered (parse
failure, missing source arg, no-adapter non-TTY case) render the error
state as the view's *first* visible frame. There is no separate stderr
channel for user-facing errors — the view IS the output, success or
failure. Verbose `--verbose` debug lines continue to flow to stderr
alongside the view, unaffected.

#### D5.2. Top-level flow

`add/index.ts:run` SHALL execute (in order):

1. Mount Ink instance hosting `<InstallView state={'idle'} />`. No
   visible output yet.
2. Validate args. Missing/malformed source → set state to `error`,
   exit non-zero. View renders the error frame on its way out.
3. Parse source via `parseSource()`. Invalid → set state to `error`,
   exit non-zero.
4. Resolve installed adapters. If zero installed:
   - TTY → unmount the outer Ink instance, run
     `pickAndInstallAdapters()` (D6) which has its own Ink session,
     wait for it to complete or abort; if the user installed at least
     one adapter, re-mount the outer instance back to `idle` and
     continue. If the user aborted, exit non-zero.
   - Non-TTY → set state to `error` with the same "no adapters
     installed" message and exit code as today's `install`.
5. Acquire the install lock (`acquireInstallLock`).
6. **Pre-resolve.** For registry sources whose `version.kind` is
   `'unspecified'`, call `resolveRegistryMetadataBatch([entry])` (D3)
   to obtain the exact version. Rewrite the in-memory `Source` to
   `{ ..., version: { kind: 'exact', major, minor, patch } }`. The
   stub throws today; the error path sets state to `error` and exits.
7. Snapshot `facets.json` bytes (or record `existed: false` if absent).
   See D5.6 for snapshot mechanics.
8. `upsertFacetInManifest` + `writeFacetsJson` to persist the new
   (now-exact-pinned) entry.
9. Call `runInstall()` with the single-entry array. `runInstall`
   streams stage events to `<InstallView />` via a structured
   `onStage` channel; the view's reducer updates state per event.
10. On `runInstall` success: state becomes `done` with the
    `RunInstallResult`. Final frame renders the success summary.
11. On `runInstall` throw: restore the `facets.json` snapshot from
    step 7, then set state to `error`. `runInstall` is responsible
    for its own lockfile atomicity; `facet add` does NOT snapshot
    or restore the lockfile.
12. Release the install lock.
13. Unmount Ink instance. Final frame stays in scrollback.

Step ordering invariants:
- Lock acquisition (5) precedes pre-resolve (6) so registry metadata
  is fetched under lock protection. Closes the theoretical window
  where two concurrent `facet add` runs could pin different versions.
- Snapshot (7) precedes write (8). Failure before step 8 needs no
  rollback; failure at or after step 8 triggers snapshot restore.
- `runInstall`'s lockfile work is atomic (its contract from D1).
  `facet add` does not concern itself with lockfile rollback.

#### D5.3. Stage event channel

`runInstall` SHALL emit per-facet, per-phase events via an
`onStage(event: StageEvent)` callback:

```ts
type StageEvent =
  | { kind: 'resolving'; facetName: string }
  | { kind: 'resolved'; facetName: string; bundle: BundleSummary; previous?: string }
  | { kind: 'downloading'; facetName: string }
  | { kind: 'cached'; facetName: string }
  | { kind: 'materializing'; facetName: string; adapterName: string }
  | { kind: 'materialized'; facetName: string; adapterName: string }
  | { kind: 'lockfile-writing' }
  | { kind: 'done'; result: RunInstallResult }
```

Events fire as each individual facet hits each phase, even when work
is batched (see D5.4). The `previous` field on `resolved` carries the
prior specifier when re-adding an existing facet (D5.5). No `error`
event — failures throw and the caller sets the view's `error` state.

#### D5.4. Batching inside `runInstall`

The pipeline phases inside `runInstall` SHALL be batched for
efficiency, even though events are per-facet:

- **Resolve phase**: registry metadata for all `unspecified`/range
  entries SHALL go through one batch call —
  `resolveRegistryMetadataBatch(entries)`. Today's stub throws; the
  initial real implementation MAY fan out concurrent fetches behind
  the same function signature. If `facets.cafe` later exposes a
  batch endpoint, only this function's body changes; callers are
  unaffected.
- **Download phase**: cache-miss tarball downloads SHALL run with
  bounded concurrency (a small connection pool). Each completion
  fires a per-facet `cached` or `downloading→cached` event sequence.
- **Build phase**: parallel per facet for git/local sources;
  collapsed into the cache-fill step for registry sources.
- **Materialize phase**: per facet, all adapters in parallel. Each
  `(facet, adapter)` pair emits a `materializing` start event and a
  `materialized` completion event so the view can render per-adapter
  ticks for single-facet runs.

#### D5.5. View rendering policy

`<InstallView />` SHALL select between two rendering modes based on
the number of facets being processed:

- **Single-facet mode** (typical for `facet add`, rare for `install`):
  full per-facet detail. `Resolving <name>…` header → `Bundle
  contains: …` breakdown → server-warning block (D4) if any →
  `Installing to adapters:` block with per-adapter spinner→tick →
  final `+ <name>@<version>` line (or `+ <name>@<new> (was <old>)`
  for re-adds) → `<n> facet installed [Xms]` summary → `Now
  /<command> is available to your agents.` footer when the facet
  declares any commands.
- **Multi-facet mode** (typical for `facet install` cold or with
  drift): aggregate progress only. `Resolving <n> facets…` header,
  no per-facet bundle breakdown, then the aggregate `+
  <name>@<version>` (or `+ <name>@<new> (was <old>)`) list at the
  end with one line per `isNew` or `wasUpdated` entry. Final
  `<n> facets installed[, <m> unchanged] [Xms]` summary. The
  `/command` footer SHALL NOT fire (would be spam).
- **Multi-facet, no changes**: short-circuit to `Checked <n> facets
  across <m> adapters (no changes) [Xms]`. Mirrors `bun install`
  warm.

The bundle breakdown for a facet declaring no assets renders as:

```
Bundle contains: nothing.
  (this facet declares no assets — adding it to facets.json anyway)
```

Operation proceeds normally; the lockfile entry is recorded.

#### D5.6. Manifest rollback (snapshot + restore)

The rollback mechanism for `facets.json` SHALL be a byte snapshot
captured at step 7 of D5.2:

```ts
type ManifestSnapshot =
  | { existed: true; bytes: Uint8Array }
  | { existed: false }
```

On failure at or after step 8:

- `existed: true` → atomic-write the captured bytes back to
  `facets.json` (using the same write-temp-then-rename pattern as
  `writeFacetsJson`).
- `existed: false` → `unlink` the file written in step 8.

The snapshot mechanism is byte-level rather than computed-inverse
(`removeFacetFromManifest` paired with `upsertFacetInManifest`) for
two reasons:

- The install lock is held for the entire `facet add` operation;
  concurrent edits are not a concern.
- Byte snapshot is one read + one write with no special-cases for
  was-update vs. was-add. Computed inverse handles both cases via
  different code paths.

Rollback failures (e.g. write permission revoked between snapshot
and restore) SHALL be surfaced via the view's `error` state with
both the original error AND the rollback error, so the user knows
the project is in a partially-modified state and what to inspect.

#### D5.7. Re-add behavior

When `facet add <spec>` resolves a facet whose name already exists in
`facets.json`:

- `runInstall` SHALL include the previous specifier on the
  `resolved` stage event (`previous` field).
- The view SHALL render the success line as `+ <name>@<new>
  (was <old>)` instead of plain `+ <name>@<new>`.
- If the new specifier resolves to byte-identical lockfile contents
  (same exact version + integrity), `runInstall` SHALL still proceed
  (idempotent re-materialize from cache; near-instant). The lockfile
  entry is rewritten with the same content; the view shows the
  `(was <same-as-new>)` form. This is intentional — re-adding is a
  valid recovery use case ("something seems off; let me re-install
  this") and idempotency is more valuable than skip-on-no-change
  optimization.

#### D5.8. The `<InstallView />` component

`commands/install/install-view.tsx` (new file) SHALL house the shared
view component. It is analogous in shape to today's `BuildView`
(`commands/build.ts`): accepts a `state: ViewState` prop, renders
based on phase, uses Ink's standard primitives (`Text`, `Box`,
`Spinner`). Spinners and the gradient progress bar SHALL match the
project's existing house style; no new Ink helpers required.

Both `commands/add/index.ts` and `commands/install/index.ts` import
the same component. Per D1, this is the single canonical UX surface
for the "facet install transaction" — there is no plain-text
fallback path elsewhere in the codebase.

#### D5.9. Alternatives considered

- *Mount the Ink view only after pre-flight succeeds.* Rejected —
  the view can render `null` for any pre-display state, so there is
  no UX cost to mounting early. Mounting from frame zero means error
  rendering goes through the same code path as success rendering;
  splitting the boundary creates two error-rendering surfaces.
- *Treat the no-adapter picker as a nested Ink instance inside the
  outer view.* Rejected — Ink does not handle nested instances
  cleanly (stdin focus, render isolation). Sequential mount/unmount
  cycles are how `facet adapter install` already works; reusing that
  pattern is simpler and already tested.
- *Per-phase events without per-facet granularity (`{ kind:
  'resolving' }` covering the whole batch).* Rejected — the
  single-facet `add` case wants per-facet detail (it's the entire
  point), and `install` can collapse to aggregate at the *view*
  layer rather than at the event-source layer. Same events, two
  rendering policies.
- *Compute-inverse manifest rollback (`removeFacetFromManifest`).*
  Rejected — no benefit over byte-snapshot under the install lock,
  and adds was-update vs. was-add branching that byte-snapshot
  collapses to a single code path.
- *`facet add` snapshots the lockfile as belt-and-suspenders.*
  Rejected — `runInstall` owns lockfile atomicity. Defense-in-depth
  here is a smell that we don't trust the inner contract; the right
  fix is to fix the inner contract, not paper over it.

### D6. Picker extraction

#### D6.1. Module split

The TTY-gated picker flow currently inlined in
`adapter/index.ts:85-156` (`handleInstallPicker`) SHALL be extracted
into `adapter/pick-and-install.ts` exporting:

```ts
export async function pickAndInstallAdapters(): Promise<{
  installedAdapters: Adapter[]   // empty array if user aborted
  aborted: boolean                // true if user quit picker without installing anything
}>
```

The function body retains today's behavior:

1. TTY guard. Non-TTY → caller decides what to do (the function
   itself does not write to stderr; it returns
   `{ installedAdapters: [], aborted: true }` and the caller frames
   the error appropriately for its own UX). This differs from
   today's inline version, which writes a CLI error directly —
   moving that out lets `facet add` render the error through its
   Ink view (D5.1) and `facet adapter install` keep its current
   plain-stderr error.
2. Discover already-installed adapters via
   `listInstalledAdapters(getAdapterBaseDir())` so the picker can
   render "(installed — select to update)" rows in green.
3. Mount `<InstallPicker />` Ink component (its own Ink session,
   independent of any outer instance).
4. Wait for confirm or abort via `instance.waitUntilExit()`.
5. On confirm with non-empty selection: sequentially install each
   picked adapter via `installAdapter()`. Stop at the first
   failure. Collect the resulting `Adapter` instances.
6. Return `{ installedAdapters, aborted }`.

#### D6.2. Caller updates

- `commands/adapter/index.ts:handleInstallPicker` becomes a
  one-liner that delegates and translates the result to a CLI
  exit code. Behavior unchanged from a user's perspective.
- `commands/add/index.ts` calls `pickAndInstallAdapters()` from
  step 4 of D5.2 when zero adapters are installed AND TTY. The
  outer Ink instance is unmounted before the call (per D5.2) so
  the picker has clean stdin/stdout focus.

#### D6.3. Return shape rationale

Returning the `Adapter[]` directly (rather than `void` plus a
re-query of `loadInstalledAdapters()`) avoids a redundant disk
walk and keeps the call composable: `facet add`'s next step
operates on the returned adapters without re-discovery.

The `aborted: boolean` field discriminates "user picked nothing"
from "install failed mid-way" — both yield an empty
`installedAdapters` array, but the caller's response differs
(abort is user-driven and the right exit code is non-zero with
a quiet message; mid-way failure already wrote its own diagnostic
during `installAdapter`).

#### D6.4. Alternatives considered

- *Have `facet add` print "no adapters installed; run 'facet
  adapter install'" and exit.* Rejected — the demo's magic moment
  is exactly the auto-flow into the picker. Forcing a separate
  command breaks it.
- *Return `Promise<void>` and have callers re-query
  `loadInstalledAdapters()`.* Rejected — wastes a disk walk and
  loses the abort/no-install-failed distinction.
- *Nest the picker as a child component inside the outer Ink
  instance.* Rejected — Ink does not handle nested instances
  cleanly. Sequential mount/unmount is what `facet adapter
  install` already uses; reusing the pattern is simpler.

## Risks / Trade-offs

### Refactor risks

- **[Risk] `runInstall()` extraction breaks an existing install path.**
  Mitigation: land the extraction with `installCommand.run` reduced to
  a thin caller first, with no behavior changes; gate the refactor
  behind the existing install test suite (`commands/install/__tests__/`).
  All tests SHALL pass before any add-side changes land.
- **[Risk] Batched `runInstall` introduces concurrency bugs in
  resolution or download fan-out.** Mitigation: bounded-concurrency
  pool with a small N (initial value: 4); deterministic event-emission
  ordering for tests; resolver functions are pure given a metadata
  response; integration tests assert that an N-facet install produces
  the same lockfile as N sequential single-facet installs.
- **[Risk] Picker extraction subtly changes `facet adapter install`
  behavior.** Mitigation: keep the existing `handleInstallPicker` as a
  one-line caller; assert via integration test that the picker UX, the
  CLI exit codes, and the error messages are byte-identical to today.

### Source-grammar risks

- **[Risk] SCP-style URL regex over- or under-matches.** Mitigation:
  borrow the regex from `npm/npm-package-arg` (`isGit`); unit-test
  against GitHub, GitLab, Bitbucket, Gitea, and self-hosted forms.
- **[Risk] Path-detection regex misses an OS-specific case (Windows
  network paths, etc.).** Mitigation: borrow `isWindowsFile` from npm,
  unit-test on macOS/Linux at minimum; document the supported path
  forms in `docs/cli/add.md`.
- **[Risk] Asterisk-only range syntax confuses users coming from
  npm/cargo who expect `^` / `~`.** Mitigation: hard-error on those
  operators with a copyable suggestion: `version range '^1.2.0' is not
  supported; use '1.*' for the same effect, or pin exactly with
  '1.2.3'`. Documented in `docs/cli/add.md` with a side-by-side
  comparison.
- **[Risk] `git+` hard-reject breaks a partner copying examples from
  npm docs.** Mitigation: the error message is actionable (it gives the
  exact URL form to use). No tolerate-and-warn period; pre-users.

### Registry / cache risks

- **[Risk] Registry stub error confuses partners who don't realize
  bare-name resolution isn't yet wired up.** Mitigation: error message
  names the registry, points at a status page (TODO URL), and suggests
  the `github:` shortcut as the immediate workaround. Documented in
  `docs/cli/add.md`.
- **[Risk] Cache directory permissions / disk space / cross-user
  contention** (e.g., shared `~/.facets/cache/` between projects).
  Mitigation: `~/.facets/cache/` is per-user (under `$HOME`), so
  cross-user contention isn't a default concern; cache miss with a
  permission error surfaces as a normal install error pointing at the
  cache path. `FACETS_CACHE_DIR` exists for CI / sandbox use.
- **[Risk] `FACETS_CACHE_DIR` misconfiguration in CI** (path doesn't
  exist, isn't writable, or points at something nonsensical).
  Mitigation: validate the override at first use with a clear error
  ("FACETS_CACHE_DIR=<path> is not writable"); cache directory
  creation is best-effort with a helpful message on failure.
- **[Risk] Check A (cache vs. metadata) firing spuriously when the
  registry's metadata legitimately changes** (e.g., the registry
  republishes a corrected integrity for a yanked-and-restored
  version). Mitigation: the design intentionally treats this as a
  hard error rather than silently accepting — that's the point of
  the integrity contract. The recovery path is `facet update` (out
  of scope for this proposal). For this proposal: document the error
  and the recovery direction; assume republished integrity is rare
  enough that hard-failing is the right default.
- **[Risk] Lockfile-vs-registry integrity mismatch (D3.4) on first
  fresh clone gives users a scary error their team didn't see.**
  Mitigation: error message names the lockfile entry, the registry's
  current claim, and explicitly says "this means the lockfile and
  registry disagree — re-pull the lockfile, run `facet update`, or
  contact the facet author." Treats it as a security event because
  it is one.

### Lockfile-driven install risks

- **[Risk] Users don't realize `facets.lock` is meant to be committed
  to the repo and `.gitignore` it.** Mitigation: `facet add` SHALL
  print a one-line hint on first lockfile creation:
  `(committed facets.lock; this is the integrity contract — keep it in
  version control)`. Documented in `docs/cli/install.md` with a
  rationale section.
- **[Risk] Users expecting `facet install` to refresh ranges** (npm-
  style "I changed my package.json, install picks up the new version")
  are surprised when nothing updates. Mitigation: documented behavior;
  `facet update` (out of scope) is the answer; `facet install` error
  message points at it if the user appears to be looking for an
  update. Specifically: when `facet install` is a no-op AND the
  manifest contains range entries (`*`, `MAJOR.*`, `MAJOR.MINOR.*`),
  the success line includes a hint:
  `(<n> entries have ranges in facets.json; run 'facet update' to
  re-resolve)`.

### `facet add` flow risks

- **[Risk] Manifest rollback fails partway through (e.g., write
  permission revoked between snapshot and restore).** Mitigation:
  D5.6 — surface the original error AND the rollback error to the
  user via the view's `error` state, so they know the project is in
  a partially-modified state and what to inspect.
- **[Risk] User SIGINTs during `runInstall`.** Mitigation: existing
  install journal already handles SIGINT-driven rollback; the
  manifest-snapshot restore in `facet add` runs in the same
  finally-block path.
- **[Risk] Re-add of the same facet@version proceeds normally and
  re-materializes; user wanted skip-on-no-change for speed.**
  Mitigation: re-materialize from cache is near-instant (no network,
  no build); the perceived cost is in the tens of milliseconds. The
  recovery use case ("something seems off; re-install this") is
  worth that cost.

### UX trade-offs

- **[Trade-off] Picker auto-launch on zero adapters.** Surprises CI
  users who set up a project on a dev box and expect `facet add` to
  fail fast in CI. The non-TTY guard is the safety net — same exit
  code and message as today.
- **[Trade-off] Multi-facet `install` collapses per-facet detail in
  favor of bun-style aggregate `+` summary** (D5.5). Loses
  per-facet visibility for users who'd want to see exactly what's
  happening when 50 facets install. Mitigation: `--verbose` gives
  back per-facet stderr output. The view stays clean for the common
  case.
- **[Trade-off] Asterisk-only ranges are less expressive than full
  semver.** Loses the ability to say `>=1.2 <2.5` or `1.2 || 1.4`.
  Justification: the four supported forms cover the real-world cases
  (any / major / minor / exact) with zero ambiguity. We can grow the
  grammar later if real demand emerges; we cannot easily shrink it
  once shipped.

## Migration Plan

The implementation lands in **stages**, each as its own PR, in this order:

### Stage 1 — `runInstall()` extraction (no behavior change)

Land `runInstall(opts): Promise<RunInstallResult>` in
`commands/install/run-install.ts`, with `installCommand.run` reduced
to a thin caller. All existing install tests SHALL pass byte-identically.
Lockfile semantics, output format, exit codes, error wording — nothing
visible changes.

### Stage 2 — Source grammar rewrite

Rewrite `parse-source.ts` with the asterisk-only range grammar, the
npm-aligned regexes, and the `Source` / `VersionSpec` tagged unions.
Update `parse-source.test.ts`: replace the "bare names rejected" test
with parse cases for each version form; add SCP-form tests; add `git+`
hard-reject test; add `file:`-strip-and-normalize test. `add` and
`install` continue to work because nothing calls into the registry
branch yet (existing entries are git or local).

### Stage 3 — Resolver pipeline + cache

Add `commands/install/resolve-source.ts` exporting `resolveSource()`
and the `ResolvedSource` type. Move the existing git-clone and
local-resolve logic into this module's `git` and `local` branches.
Add the cache-write logic (`<name>@<version>/` for git, `<name>@local/`
for local). Add `~/.facets/cache/` directory management +
`FACETS_CACHE_DIR` override. The `registry` branch throws
`registry resolution not yet implemented`. Wire `runInstall` to call
`resolveSource()` in place of the inline clone/local logic.

### Stage 4 — Registry stubs + integrity protocol

Add `resolve-registry-metadata.ts` exporting
`resolveRegistryMetadataBatch(entries)` and
`download-facet-tarball.ts` exporting `downloadAndExtractFacet(url)`.
Both throw with `// TODO(registry):` markers. Wire the `registry`
branch in `resolveSource` to call them, including all three integrity
checks (D3.2). Add the lockfile-vs-registry integrity comparison
(D3.4) inside `runInstall`. Tests assert each check fires the right
error on each kind of mismatch (using fixture-injected stubs).

### Stage 5 — Servers / composition behavior

Replace the existing rejection guard at
`install/index.ts:443-447` with the split behavior: hard-reject
`facets` composition (unchanged error wording), warn-and-skip
`servers` (D4). Pass declared server names through
`resolveSource` → `runInstall` → `onStage` → `<InstallView />`.

### Stage 6 — Picker extraction

Move `handleInstallPicker` into
`adapter/pick-and-install.ts:pickAndInstallAdapters()` with the
return shape from D6.1. `commands/adapter/index.ts:handleInstallPicker`
becomes a one-line delegate. Behavior of `facet adapter install`
remains byte-identical.

### Stage 7 — `<InstallView />` + Ink rendering

Add `commands/install/install-view.tsx` with the `ViewState` machine
from D5.1. Wire `installCommand.run` to mount it and consume `onStage`
events from `runInstall`. `facet install` output now flows through
Ink for the success path; the plain-text format from today is
preserved as the *rendered output* of the view (so the on-screen
difference is purely visual: spinners replace inline log lines, ticks
replace prose, etc.). Existing install tests assert the *content* of
output, not the rendering; should pass without changes.

### Stage 8 — `facet add` rewrite

Rewrite `add/index.ts` per D5.2. Lock acquisition, pre-resolve,
manifest snapshot, write, `runInstall`, rollback. Mounts the same
`<InstallView />`. Single-facet rendering policy fires (D5.5).

### Stage 9 — Tests + docs

Add `add` integration tests for: success, rollback on build failure,
rollback on materialize failure, rollback on lockfile-write failure,
no-adapter TTY (picker mocked), no-adapter non-TTY, `git+` hard-reject,
server-warning path, bare-name registry-stub error,
lockfile-vs-registry integrity mismatch, cache hit, cache miss,
re-add (was → new). Update `docs/cli/add.md`,
`docs/cli/install.md`, `README.md`, `CHANGELOG.md`. File new ADRs
in Notion (see ADR Impact below).

**Rollback strategy**: each stage lands as its own PR; revert the
offending PR. The two highest-risk stages are 7 (Ink rendering for
`facet install`, which changes visible behavior of an existing
command) and 8 (`facet add` rewrite). Both are guarded by integration
tests and are reversible via revert.

**Why no feature flag?** The new behavior is strictly more useful for
the user-facing add path; for the install path the change is
visual-only with content equivalence preserved. Feature-flagging an
Ink-rendering refactor is over-engineering for a pre-users codebase.

## Documentation Impact

- `docs/cli/add.md`: currently a WIP stub. SHALL be rewritten to
  cover: the new combined add-and-install flow, the asterisk-only
  range grammar with a side-by-side npm/cargo comparison, the source
  grammar table with all six accepted forms, the server-warning
  example, the registry-stub error and the `github:` workaround, the
  default-to-pinned storage rule.
- `docs/cli/install.md` (currently a WIP stub): SHALL document the
  lockfile-driven semantics — `facet install` reads the lockfile and
  doesn't re-resolve ranges, `facet update` is the way to refresh
  ranges (forward-reference; `update` is out of scope for this
  proposal). Note that `facets.lock` is intended to be committed.
- `docs/cli/adapter.md` (if present): SHALL note that
  `facet adapter install` (no args) launches the same picker that
  `facet add` uses on no-adapter projects.
- `README.md`: the "Quick start" example SHALL be updated to drop
  the separate `facet install` step.
- `CHANGELOG.md`: announce combined add+install, asterisk-only
  range syntax, default-to-pinned behavior, simplified git grammar
  (incl. SCP-style support, `git+` prefix removed), `file:` strip-
  and-normalize, server-warning behavior, registry stub +
  three-check integrity protocol, `~/.facets/cache/` cache + the
  `FACETS_CACHE_DIR` override.

## ADR Impact

No ADRs are being filed for this change. Per project direction, the
decisions captured in this design document and the OpenSpec change
artifacts are the authoritative record. Constitution Article III's
ADR-filing expectation is explicitly waived for this change in favor
of the OpenSpec workflow.
