# Comparison review — `proposal` (add-mcp-json-support)

**Main**: `openspec/changes/add-mcp-json-support/proposal.md`
**Adversary**: `openspec/changes/add-mcp-json-support/adversarial/artifacts/proposal.md`

Both were authored from the same intent: replace the inert `servers` reference map with concrete, portable MCP connection declarations, materialized through adapters into tool-native project config, with no registry, no Facets MCP runtime, and no credential handling.

## Grading bar

- **Value-centric**: does the proposal justify itself in user-visible outcomes, not machinery?
- **RFC 2119**: normative keywords for requirement-bearing statements (Article I).
- **Correct proposal mechanics**: word budget, Non-goals present, capabilities are product domains per spec-governance, informing docs cited (Article III).
- **Coverage**: are the decisions a spec/design author needs actually settled — and are any settled wrongly?

Both versions pass mechanics: Non-goals present, capabilities use legal domain names, docs cited, both under budget (~640 vs ~840 words), RFC 2119 used in normative bullets.

## Coverage comparison

Shared coverage (equivalent substance, wording differs): breaking replacement of `servers` values; portable stdio + Streamable HTTP schema; adapter translation, never verbatim file copy; keyed ownership in shared tool-owned files with preservation of unowned state, rollback, transactional recording; removal of the standalone server artifact model (`server.json`, source/ref modes); auth delegated to the tool; warning replaced by real reporting; docs updates.

Divergences:

| # | Topic | Main | Adversary |
|---|---|---|---|
| 1 | Install-time consent for executable config | Absent | First-class: approval of each new/changed command/URL; explicit flag non-interactively; no re-prompt for unchanged approved state |
| 2 | Legacy `0.1` archives | Silent (break reads as universal) | Break scoped to current format; legacy stays inert warn-and-skip |
| 3 | Server-only facets | Silent (existing rule would reject them) | Explicitly allowed; at-least-one-asset constraint broadened |
| 4 | Project omission of a declared server | Silent | `MAY` omit; aliasing explicitly deferred |
| 5 | Adapter without MCP support | Fail before mutation | Report skipped adapters; proceed only with explicit acceptance of partial materialization |
| 6 | HTTP headers | Bans *authentication* headers (non-auth headers ambiguous) | Bans all headers in v1, with rationale (headers are predominantly credentials) |
| 7 | Env values | Silent | Literals only; secrets documented unsupported; no portable substitution grammar |
| 8 | Lockfile vs receipt versioning | "lockfile or receipt formats may require version increments" | Receipt bump needed; lockfile SHOULD stay unchanged (declarations ride on `facet.json` integrity) — verify in design |
| 9 | New capability name | `adapter__configuration` | `adapter__mcp` |
| 10 | Docs impact list | Includes `materialization.mdx` | Includes `publish.mdx`, `terminology.mdx`, and the never-shipped docs pointer the install warning was specced to include |

## Judgments per divergence

1. **Consent — Adversary, decisively.** Materializing a stdio entry makes the target tool execute a command; this is the exact reason Claude Code gates project `.mcp.json` servers behind approval. A proposal that turns facet install into a supply-chain vector without naming consent is missing its most important security requirement. Blocking.
2. **Legacy scoping — Adversary.** The repo maintains a frozen legacy `0.1` manifest schema; an unscoped "SHALL no longer be accepted" would strand legacy archives that today load and warn. One sentence of scoping avoids an accidental second breaking change.
3. **Server-only facets — Adversary raises it; either answer is acceptable, silence is not.** Constraint 1 of the facet-manifest schema rejects a manifest with only `servers`. Leaving this unstated means the specs phase decides a product question by accident. Adversary's "allow" is the natural consequence of servers becoming a real deliverable, but an explicit deferral would also be fine.
4. **Omission override — Adversary, weakly.** "Take the skills but not the server" is a real user need and the disposition machinery exists. Acceptable to defer to design, but the proposal should say which.
5. **Unsupported adapter — Main.** Fail-closed before mutation is simpler, matches the existing adapter-compatibility preflight pattern, and avoids inventing a partial-materialization consent UX in v1. Adversary's flexibility is a design-phase refinement at most. Keep Main; drop Adversary's acceptance flow.
6. **Headers — Adversary.** "No authentication headers" invites the question of which headers are non-auth; a blanket v1 ban is crisper, safer, and trivially relaxable later.
7. **Env literals — Adversary.** Cheap to state, prevents the worst authoring mistake (secrets in a published artifact), and heads off unportable `${VAR}`/`{env:VAR}` expectations.
8. **Lockfile/receipt — Adversary.** More specific and probably correct: integrity already covers `facet.json`, so declarations need no lockfile entries, while deletion authority lives in the receipt. Keep the "verify in design" hedge.
9. **Capability name — conditional.** If the new spec is written payload-agnostically (keyed configuration contributions, MCP as first payload), Main's `adapter__configuration` is the better durable name. If the spec's requirements are MCP-specific — which both proposals' language suggests — `adapter__mcp` is the honest name and avoids overpromising. Decide by how the spec will actually be written; do not leave both names in circulation.
10. **Docs list — merge.** Union both: Main's `materialization.mdx` plus Adversary's `publish.mdx`, `terminology.mdx`, and the live spec/implementation drift note (the warning's promised docs pointer never shipped — this change deletes that requirement, which resolves the drift and is worth stating).

**Where Main is stronger overall**: the auth-delegation bullet is clearer and stands alone (Adversary tucks it into the removal bullet); the Why is tighter; the unsupported-adapter rule (see #5); `adapter__configuration` if the spec is written generally. Adversary's extra ~200 words buy real decisions but push toward the budget ceiling — merged text should trim, not concatenate.

## Merge recommendation (per section)

- **Why**: keep Main's framing; borrow Adversary's concrete detail that users today hand-edit `.mcp.json` / `opencode.json` / `.codex/config.toml`.
- **What Changes**:
  - Add Adversary's consent bullet essentially verbatim (divergence 1).
  - Scope the BREAKING bullet to the current manifest format; state legacy `0.1` behavior is unchanged (2).
  - Add one bullet settling server-only facets — allow (or explicitly defer with rationale) (3).
  - State the omission decision or explicitly defer both aliasing and omission to design (4).
  - Keep Main's fail-before-mutation rule for unsupported adapters; do not adopt partial-materialization acceptance (5).
  - Keep Main's standalone auth-delegation bullet.
- **Non-goals**: adopt Adversary's blanket no-headers bullet in place of Main's "authentication headers" phrasing (6); add Adversary's env-literals/no-substitution-grammar and no-secrets language (7); add "no aliasing of server names" if omission is adopted; keep the rest of Main's list.
- **Capabilities**: pick one name per #9 and align the description with it; adopt Adversary's sharper `adapter__assets` phrasing ("confine the asset-methods-only rule to text assets"); if server-only facets are allowed, add the broadened constraint to the `protocol__schemas` entry.
- **Impact**: replace Main's vague version-increment sentence with Adversary's receipt-bump / lockfile-likely-unchanged hypothesis (hedged for design) (8); union the docs lists and mention the resolved docs-pointer drift (10).

## Blocking items before archive

1. **Consent model** (divergence 1) must be in the proposal — it changes CLI scope, installation spec requirements, and the security story.
2. **Server-only facets** (3) must be decided or explicitly deferred — it alters a published manifest constraint.
3. **One rule for unsupported adapters** (5) — Main and Adversary currently prescribe incompatible behaviors; specs cannot be written until one is chosen.
4. **Capability name** (9) — specs phase creates the directory; the name must be settled first.
