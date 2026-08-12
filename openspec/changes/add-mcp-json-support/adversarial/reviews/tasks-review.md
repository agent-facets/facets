# Comparison Review: `tasks`

**Main**: `openspec/changes/add-mcp-json-support/tasks.md` (20 blocks, 10 Research/Implementation pairs)
**Adversary**: `openspec/changes/add-mcp-json-support/adversarial/artifacts/tasks.md` (16 blocks, 8 pairs)

Both were derived from the same reconciled `design.md` and the nine reconciled delta specs; the adversary was authored blind to the main version.

## Grading bar

Scoped to the tasks artifact: (1) correct artifact mechanics — exact preamble, `- [ ] X.Y` checkboxes, Research/Implementation block pattern, VIPER type prefixes, Explore→Propose→Implement→Verify ordering; (2) dependency ordering across blocks; (3) coverage — every design decision (D1–D11) and every delta-spec requirement reaches an implementation task and a verification; (4) task executability — small enough for one session, verifiable completion; (5) constitution Article III — documentation tasks scoped as work.

## Mechanics

Both versions carry the exact required preamble, valid checkbox numbering, the Research/Implementation split per block, VIPER prefixes on every step, a Propose closing every research group, and a Verify closing every implementation group. Both are pause-free, which is valid. **Main additionally embeds the full VIPER Step Types legend** after the preamble; the adversary relies on the preamble's instruction to load `viper-execution-rules`. Minor, but main is more self-contained for the executor. No mechanical violations on either side.

## Coverage comparison

Shared core (both cover well): closed declaration union + env-name grammar + closed-object rejection (D1), server-only minimum content, legacy `servers` rejection without fallback (D9), project manifest `0.2` dispatch and `servers` dispositions (D2), canonical fingerprint (D3), removal of the standalone `server.json` surface, receipt `0.4` with configuration claims and pre-`0.4` no-authority refinement (D3), generic effective-name planning primitive without widening `AssetType` (D4), consent from receipt claims with one MCP-only request and takeover section (D5), SDK `mcpServers: false | McpServerCapability` + support set `{0.1, 0.2}` with exact tokens (D6), three first-party adapters with prepare/apply, native equality, and preservation (D6), the reordered commit sequence with byte-preimage journaling and LIFO restore (D7), just-in-time asset takeover (D7/D8), frozen gates and receipt-only orphan cleanup, removal carry-forward with pre-`0.4` fallback, `server-warning` removal and outcome classification (D10), collision-workspace server claimants, `--accept-mcp` on all three commands, declaration-secrecy in output, and the D11 documentation sweep.

**Main covers, adversary lacks (material):**

1. **Release preparation** (17.2, 18.5): changesets for the protocol and Adapter SDK pre-1.0 minor breaks and all first-party adapters, prepack/package-publishing checks, and the adapter-first-then-CLI release sequencing. The design's migration plan step 3 ("Publish Adapter SDK API `0.2`") makes this in-scope work; the adversary has nothing on release mechanics. This is the largest coverage gap on the adversary's side.
2. **Cross-cutting acceptance block** (19/20): a requirement/scenario coverage matrix over all nine delta specs, `bun openspec validate add-mcp-json-support --strict`, and a final audit marking the change implementation-ready. The adversary ends at full-repo `bun check` with no explicit spec-coverage acceptance step.
3. **Concrete removal surfaces**: main names `serversDeclared` (12.3) alongside `server-warning`/`serverWarnings`; the adversary names only the two the design lists. Main also sweeps stale text beyond the D11 list (18.6) and includes a `bun format` normalization task (18.7).
4. **Existing-suite awareness**: prototype-pollution/prototype-safety tests in the collision workspace (13.1, 14.3), Ctrl-C/abort settlement (15.1, 16.7), adapter bundling/dist e2e constraints (3.1, 5.1–5.2, 6.5). These track real conventions in this repo (dist e2e tasks, prototype-safe key handling) that the adversary's tasks don't reach.

**Adversary covers, main lacks or is weaker (material):**

1. **Explicit rejection of the speculative reference forms in the *current* schema** (adversary 2.3 names version-string and `{ image }` rejection). Main 2.2's "replace current server references with concrete declarations" implies it but never states the rejection tests for the current format; the protocol spec has explicit scenarios for both. Small but worth folding in.
2. **Fingerprint output format** (adversary 2.5 pins deterministic `sha256:` output, matching the design's `fingerprint: \`sha256:...\`` claim shape). Main 2.3 describes the canonicalization but not the output token.
3. **Receipt writer emission rule** (adversary 4.3: next successful write emits `0.4`, never an intermediate writer format — a delta-spec scenario). Main covers receipt construction (8.5) but never states the no-intermediate-format rule as a task obligation.
4. **Self-contained adapter file-selection rules** (adversary 10.2 encodes the OpenCode `jsonc` > `json` > create-`jsonc` precedence in the task text; main 6.2 says "deterministic selection"). Executors will read the specs, so this is redundancy rather than a gap — but it makes the task verifiable without a lookup.

**Structural divergences:**

- **Block granularity**: main uses 10 pairs (splitting engine outcomes, collision UI, and consent/flags/output into separate blocks); the adversary uses 8 (one engine composition/consent block, one CLI block). Main's finer blocks are better session-sized — the adversary's block 12 (10 implements) and block 14 (7 implements) are large for single sessions.
- **Placement of the generic planning primitive**: main extracts it in the protocol block (2.5) before any consumer; the adversary extracts it in the engine composition block (6.1). Main's frontloading is the better dependency ordering — the SDK/adapter blocks and the composition wrappers both sit downstream of it.
- **Doc task style**: the adversary enumerates every D11 page inline; main references "D11 targets." Main's reference style avoids duplicating the design's list (single source of truth) at a small cost in task self-containment. Wash, slight edge to main.

## Which is stronger

**Main, overall.** It is broader where breadth matters (release mechanics, acceptance matrix, repo-convention test surfaces, stale-text sweep), finer-grained where execution matters, and its dependency ordering is at least as good. The adversary's wins are real but local: three or four concrete task-text details that make individual tasks more precisely verifiable against the delta specs.

## Merge recommendation (per block)

1. **Keep main's structure wholesale** — 20 blocks, ordering, legend, and the release-prep (17/18) and acceptance (19/20) blocks the adversary lacks.
2. **Block 2 (protocol)**: fold into 2.2 the explicit rejection of version-string and `{ image }` forms under the *current* schema (with tests), and into 2.3 the deterministic `sha256:`-prefixed fingerprint output.
3. **Block 8 (receipt/intent)**: add to 8.1 or 8.5 the explicit obligation that the next successful receipt write emits `0.4` and never an intermediate writer format.
4. **Block 6 (first-party adapters)**: optionally inline the OpenCode precedence rule (`opencode.jsonc` if present, else existing `opencode.json`, else create `opencode.jsonc`; `jsonc` canonical when both exist) into 6.2 so the task is verifiable without a spec lookup.
5. No other changes; the adversary's remaining content is subsumed by main's tasks.

## Blocking items

None. Main is executable as-is; the merge items above tighten task-level verifiability but do not change scope, ordering, or coverage of any requirement.
