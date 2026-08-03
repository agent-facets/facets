## Why

A facet can ship the skills that teach a coding tool *how* to use a service, but not the MCP connection that lets the tool *reach* it — so every consumer hand-edits `.mcp.json`, `opencode.json`, and `.codex/config.toml` after install. The reserved `servers` field promises registry-resolved server packages that do not exist; concrete connection declarations materialized through adapters deliver the value now, without a registry or runtime.

## What Changes

- **BREAKING** (current manifest format): values in the `servers` map become concrete MCP connection declarations — a tagged union of `stdio` (command, arguments, environment, working directory) and streamable HTTP (URL). The reference forms (version string, `{ image }`) SHALL be rejected. Legacy `0.1` archives SHALL retain today's inert warn-and-skip behavior; the break applies only to the current format.
- Facets SHALL define its own portable declaration schema, aligned with the de facto `.mcp.json` vocabulary. Adapters SHALL translate declarations into their tool's native project configuration; a facet SHALL NOT ship a literal tool config file, and no tool's file format is copied verbatim.
- **Installing a server declaration is a consent event.** A materialized stdio declaration causes the target tool to execute a command; a URL declaration causes it to connect out. Interactive installs SHALL present each new or changed server (command, arguments, URL) for explicit approval before any write; non-interactive installs SHALL fail unless consent is granted via an explicit flag. Reproducing an unchanged, previously approved declaration SHALL NOT re-prompt.
- Server entries SHALL be reconciled as **owned keys inside shared, tool-owned config files**: unrelated settings and unowned entries are preserved; only machine-locally owned keys may be updated or removed; mutations participate in install rollback and the transactional commit; removal of the last claiming facet removes only the owned key, never the file.
- Two facets claiming one server name with different declarations SHALL block install before any write. A project MAY record durable intent to **omit** a declared server; aliasing of server names is deferred.
- A facet MAY declare only servers: the at-least-one-text-asset manifest rule SHALL be broadened so a connection-only facet is publishable.
- When a selected adapter cannot materialize MCP configuration, the install SHALL report exactly which adapters would be skipped and SHALL proceed only with explicit user acceptance of partial materialization.
- The standalone server artifact model — the separate server manifest (`server.json`), source-mode/ref-mode terminology, and separately published server projects — SHALL be removed. Authentication SHALL remain tool-native: users authenticate through the target tool after materialization.
- Documentation SHALL be updated to describe concrete declarations, consent, ownership, and the security posture.

## Non-goals

- No MCP runtime in Facets: no client, host, proxy, lifecycle management, health checks, or connection probing.
- No server registry: no publishing, resolving, or versioning of standalone server packages or OCI images.
- No credential handling: no HTTP headers (which are predominantly bearer credentials), tokens, OAuth flows, secret storage, or portable environment-variable substitution grammar. Environment values in stdio declarations are literals; secrets in declarations are documented as unsupported and unsafe.
- No installation or verification of the executable a stdio declaration names.
- No user- or system-scope materialization; project configuration only.
- No SSE or WebSocket transports; no tool-specific policy options (timeouts, tool allowlists, approval modes).
- No aliasing of server names in this release.

## Capabilities

### New Capabilities

- `adapter__mcp`: the adapter contract for translating portable MCP declarations into tool-native project configuration and transactionally reconciling owned keys while preserving all unowned state.

### Modified Capabilities

- `protocol__schemas`: replace server references with the concrete declaration union; remove the server-manifest schema; broaden the at-least-one-asset constraint; version machine-local ownership records for keyed entries.
- `authoring__facets`: authors declare portable MCP connections in `facet.json` and get actionable validation errors.
- `authoring__servers`: retired — the separate server-project authoring contract is removed until standalone servers are deliberately designed.
- `installation`: plan, collide, gain consent for, materialize, roll back, and remove keyed server contributions inside the existing transaction, including frozen reproduction and removal-only installs.
- `adapter__sdk`: expose the MCP capability and its compatibility identifier to adapter authors.
- `adapter__assets`: confine the "asset methods are the only storage interface" rule to text assets so keyed configuration has its own contract boundary.
- `cli`: consent prompts, per-adapter skip acceptance, and reporting of server additions, updates, conflicts, and removals in place of today's warning.

## Impact

- **Protocol**: incompatible `facet.json` change for current-format manifests using `servers`; server-manifest API removed. The install receipt needs a version increment for keyed ownership; the lockfile SHOULD remain unchanged if declarations ride on `facet.json` integrity — to be verified in design.
- **Adapters**: adapter API identifier changes; Claude Code, OpenCode, and Codex adapters implement safe read-modify-write of JSON, JSONC, and TOML project config.
- **Engine**: compose, collision detection, ownership, journaling, frozen mode, and removal-only refinement extend to keyed contributions without widening the text-asset type.
- **CLI**: new consent and reporting flows in add/install.
- **Documentation**: informed by `docs/specification/manifest.mdx` (servers field), `docs/cli/install.mdx` (Servers), `docs/specification/commit.mdx` ("Not in the install flow"), `docs/specification/publish.mdx` (server references), `docs/specification/terminology.mdx` (text-asset framing), and `docs/roadmap/beta.mdx` (MCP beta gate) — all of which must change, along with the missing server documentation page the install warning was specified to point at.
