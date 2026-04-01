---
status: accepted
date: 2026-03-28
decision-makers: julian
---

# ADR-006: Manifest Serialization Format

## Status History

| status   | date       | decision-makers | github |
| -------- | ---------- | --------------- | ------ |
| proposed | 2026-03-28 | julian          |        |
| accepted | 2026-03-29 | julian          |        |

## Context and Problem Statement

The facets system has several manifest types: the facet manifest (ADR-001), the server manifest (ADR-005), the build manifest (ADR-004), and the lockfile (ADR-003). All are machine-managed — the CLI creates and mutates them, authors edit `.md` content files rather than manifests directly. This ADR decides the serialization format for all project manifests.

The format choice should optimize for machine reliability over human authoring ergonomics.

## Decision Drivers

* **Machine authoring is the primary path.** The CLI scaffolds and manages all manifests. Authors edit `.md` content files, not manifests directly. Format ergonomics for hand-editing are secondary to machine reliability.
* **Serialization simplicity.** `JSON.stringify` is built-in and produces readable output. YAML serializers are complex, vary across implementations, and produce inconsistent output (quoting styles, whitespace). Note: neither JSON nor YAML guarantees stable key ordering after a parse-serialize roundtrip — runtime object key ordering is non-deterministic. Deterministic content hashing is a property of the build pipeline (ADR-004), not of the manifest file on disk.
* **Parsing reliability.** The manifest is a contract — ambiguous parsing is unacceptable. YAML has implicit type coercion (`1.0.0` → number `1`, `no` → boolean `false`, `on` → boolean `true`) that creates subtle bugs. JSON has zero parsing ambiguity.
* **Dependency minimization.** Fewer runtime dependencies reduce supply chain risk and build complexity. `JSON.parse` is built into every JavaScript runtime. YAML requires a third-party parser package.

## Considered Options

* YAML
* JSON
* JSONC (JSON with Comments)
* JSON5
* TOML

## Decision Outcome

Chosen option: **JSON**, because it is the only format that scores well on all four decision drivers: zero parsing ambiguity, serialization simplicity, zero runtime dependencies, and universal tooling support.

All project manifests use JSON:

| Manifest        | Filename               | Schema ADR |
| --------------- | ---------------------- | ---------- |
| Facet manifest  | `facet.json`           | ADR-001    |
| Server manifest | `server.json`          | ADR-005    |
| Build manifest  | `build-manifest.json`  | ADR-004    |
| Lockfile        | `facets.lock`          | ADR-003    |

The manifest schemas defined in their respective ADRs are format-agnostic — they define structure, not serialization. This ADR governs serialization for all of them.

### Consequences

* Good, because zero parsing ambiguity — what you write is what you get
* Good, because `JSON.parse()` is built into every JavaScript runtime — no parser dependency needed
* Good, because `JSON.stringify(data, null, 2)` produces clean, readable output
* Neutral, because JSON requires quoting all keys and string values — irrelevant since the CLI manages the manifest, not humans
* Neutral, because JSON has no comment syntax — irrelevant since the manifest is machine-managed and the schema is documented in ADR-001

### Confirmation

- All manifest loaders read `.json` files via `JSON.parse()`
- The scaffold generator writes `facet.json` via `JSON.stringify()`
- The build pipeline writes `build-manifest.json` via `JSON.stringify()`
- All tests pass with JSON manifest fixtures
- The `yaml` runtime dependency is removed

## Pros and Cons of the Options

### YAML

Widely used for configuration files (Docker Compose, GitHub Actions, Kubernetes).

* Good, because no quoting needed for keys or most string values
* Good, because comments are supported
* Good, because less visual noise than JSON for hand-authored files
* Good, because familiar to DevOps-oriented developers
* Bad, because implicit type coercion creates subtle bugs (`1.0.0` → `1`, `no` → `false`, `on` → `true`)
* Bad, because the spec is extremely complex (83 pages) leading to parser inconsistencies across implementations
* Bad, because serializers do not guarantee stable output — key ordering, quoting style, and whitespace vary
* Bad, because requires a runtime dependency (`yaml` package)
* Bad, because YAML serializers don't produce reliably formatted output, often requiring manual string construction

### JSON

Standard data interchange format. Built into every JavaScript runtime.

* Good, because zero parsing ambiguity
* Good, because zero runtime dependencies
* Good, because `JSON.stringify` produces clean, readable output
* Good, because universal tooling support (every editor, every language, every API)
* Neutral, because mandatory quoting of all keys and strings — not a concern when the CLI writes the file
* Bad, because no comment syntax — not a concern when the manifest is machine-managed

### JSONC (JSON with Comments)

JSON extended with `//` and `/* */` comments. Used by VS Code (`settings.json`), TypeScript (`tsconfig.json`), and Deno (`deno.jsonc`).

* Good, because comments are supported
* Good, because otherwise identical to JSON in syntax and semantics
* Good, because familiar from VS Code and TypeScript ecosystem
* Bad, because comments are lost on roundtrip — parse strips comments, serialize doesn't reproduce them
* Bad, because not a formal standard — parser behavior varies across implementations
* Bad, because the marginal benefit over JSON (comments) is irrelevant when the manifest is machine-managed

### JSON5

JSON extended with unquoted keys, trailing commas, single-quoted strings, and comments.

* Good, because more relaxed syntax than JSON for hand-editing
* Good, because comments are supported
* Bad, because non-standard — requires a runtime dependency (`json5` package)
* Bad, because relaxed syntax benefits only apply to hand-editing, which is not the primary authoring path
* Bad, because less tooling support than JSON or JSONC

### TOML

Configuration format designed for readability. Used by Rust (`Cargo.toml`), Python (`pyproject.toml`).

* Good, because no quoting needed for most keys
* Good, because comments are supported
* Good, because clear table/section syntax for shallow structures
* Bad, because **mixed-type arrays are not supported** — the `facets` field in the manifest schema requires arrays containing both strings and objects (compact and selective forms), which is invalid TOML. This is a hard blocker that would require restructuring the schema to work around.
* Bad, because deeply nested maps become awkward (e.g., `[agents.reviewer.platforms.opencode]`)
* Bad, because requires a runtime dependency
* Bad, because less common in the JavaScript ecosystem

## More Information

* ADR-001 (Facet Manifest Schema), ADR-005 (Server Manifest), ADR-003 (Lockfile), and ADR-004 (Build Manifest) define schemas; this ADR governs the serialization format for all of them
* The archive format (`.facet` files produced by `facet build`) contains `facet.json`
* The lockfile filename is `facets.lock` (format-agnostic name, like `Cargo.lock`) with JSON content
