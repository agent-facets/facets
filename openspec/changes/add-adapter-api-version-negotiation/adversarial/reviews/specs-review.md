# Comparison Review: `specs` — add-adapter-api-version-negotiation

**Main**: `specs/adapter__sdk/spec.md`, `specs/adapter__management/spec.md`, `specs/installation/spec.md`
**Adversary**: `adversarial/artifacts/specs/adapter__sdk/spec.md`, `adversarial/artifacts/specs/adapter__management/spec.md`, `adversarial/artifacts/specs/installation/spec.md`

Both were derived from the reconciled proposal; the adversary authored blind to the main version.

## Grading bar

- **Value-centric** (spec-governance): observable behavior for users/adapter authors, no internal module or class names, no domain-name subjects.
- **RFC 2119**: normative keywords in every requirement.
- **Atomic + testable**: one concern per requirement; scenarios concrete enough to test.
- **Artifact mechanics**: correct ADDED/MODIFIED usage; MODIFIED blocks carry full updated content with exactly-matching headers; 4-hashtag scenarios.
- **Coverage**: every proposal clause (`What Changes` bullets, BREAKING note, non-goals) represented.

Both versions pass mechanics: headers of MODIFIED requirements match the permanent specs exactly, all scenarios use `####`, and full requirement blocks are carried. The differences are in coverage depth, vocabulary rigor, and two policy divergences.

## Coverage comparison

| Concern | Main | Adversary |
|---|---|---|
| `0.0` designation + exact equality | ✓ (ADDED, with identifier grammar) | ✓ (ADDED, no grammar) |
| Identifier grammar (`MAJOR.MINOR`, no suffixes/leading zeroes) | ✓ | ✗ |
| Missing/malformed/unsupported/supported classification | ✓ (explicit vocabulary, used consistently across all three files) | partial (missing/malformed/unsupported appear but are never defined) |
| SDK canonical export | ✓ (scenario inside MODIFIED define-adapter req) | ✓ (separate ADDED requirement) |
| Factory stamping | ✓ (`apiVersion` required readonly field; definition SHALL NOT *require or accept* an author identifier) | ✓ (stamp only; SHALL NOT *require* — silent on whether authors may supply a conflicting value) |
| API independence from package versions | requirement text only | requirement text **and** a dedicated scenario |
| npm selector grammar (exact/`1.*`/`1.2.*`/`*`/`latest`; reject `^`, `~`, comparators) | ✓ | ✗ ("explicit package version range", unspecified) |
| Package metadata field name (`facetAdapterApiVersion`) | ✓ (named — this is the published contract adapter authors must write) | ✗ (described abstractly) |
| Package vs runtime declaration conflict | ✓ | ✓ |
| Undeclared release ineligible (BREAKING) | ✓ | ✓ |
| No-compatible-release structured failure | ✓ (also: fail *before download*) | ✓ |
| Atomic replacement | ✓ (MODIFIED the existing "Adapter identity" requirement so the old plain-overwrite scenario is superseded; plus combined ADDED req) | ✓ (separate ADDED requirement; left "Adapter name conflict overwrites" scenario untouched) |
| Provenance | ✓ (npm: resolved version + registry integrity; repair-command scenario) | ✓ (explicit git/local scenario: no npm version recorded) |
| Diagnostics | ✓ (plus misclassification guard: never reported as "no adapters installed" / unknown metadata schema; multi-failure aggregation) | ✓ (single-failure shape only) |
| Git/local checked as supplied | ✓ (in verification MODIFIED) | ✓ (in selection ADDED) |
| Load-time gate before any adapter method | ✓ (fail with **all collected** failures) | ✓ (per-bundle failure) |
| List surfaces compatibility | ✓ (status vocabulary incl. `broken`; list stays available for recovery) | ✓ (simpler) |
| Facet-install gate before materialization | ✓ (**extends to remove**; names receipt; aggregates all incompatible adapters) | ✓ (install/add only; positive-path scenario) |

## Material divergences and which side is stronger

1. **Identifier grammar and classification vocabulary (SDK)** — **Main stronger.** Main's ADDED requirement defines the `MAJOR.MINOR` form and the missing/malformed/unsupported/supported classification, making "malformed" testable and giving all three capability files a shared vocabulary. The adversary uses these words without defining them — a real gap: "malformed" is untestable without a grammar.

2. **Factory forbids author-supplied identifiers (SDK)** — **Main stronger.** "SHALL NOT require **or accept**" eliminates a whole conflict class (author-declared version disagreeing with the SDK). The adversary only relieved authors of the obligation, leaving conflicting declarations representable.

3. **npm selector grammar (management)** — **Main stronger.** Main reuses the established four-form + `latest` grammar from the installation spec and explicitly rejects `^`/`~`/comparators, with a scenario. The adversary's "explicit package version range" is exactly the kind of vague surface the permanent specs already refused for facets. Main's "highest **stable** release" also settles prerelease handling, which the adversary never addresses.

4. **Replacement mechanics (management)** — **Main stronger on mechanics, adversary stronger on atomicity of requirements.** Main correctly MODIFIED "Adapter identity is determined by the adapter itself" so the permanent "Adapter name conflict overwrites" scenario is replaced by an atomic-activation scenario — the adversary left that plain-overwrite scenario standing, which would survive archive alongside the new staged-replacement requirement and read as contradictory. That is a genuine defect in the adversary version. However, main's combined ADDED requirement ("Adapter replacement is atomic **and retains repair provenance**") packs two concerns (atomicity; provenance) into one requirement, against the atomicity rule. The adversary's split (replacement / provenance / diagnostics as three requirements) is the better decomposition.

5. **Aggregated failure reporting (management + installation)** — **Main stronger.** Reporting *all* incompatible adapters at once (load and facet-install paths) and the misclassification guard ("SHALL NOT be reported as 'no adapters installed'") are user-observable guarantees the adversary lacks.

6. **Removal gating (installation)** — **Divergent policy; needs a decision.** Main gates add, install, **and remove** behind adapter compatibility. The adversary gates only add/install, per the proposal ("facet installation SHALL fail before any materialization writes"). The permanent installation spec deliberately makes removal receipt-driven and dependency-free ("Removal needs neither cache nor network... SHALL succeed"). If removal deletes receipt-recorded paths without invoking adapter contract methods, main's gate strands users: an incompatible adapter would block *removing* facets — the one operation that should always work. If removal does invoke adapter delete methods, main's gate is correct and the adversary under-specified. This must be settled against the design's actual removal path before archive.

7. **Positive-path installation scenario** — **Adversary only.** "Compatible selected adapters install normally" pins that the gate is a pass-through, not a new interactive step. Cheap and worth having.

8. **Git/local provenance scenario** — **Adversary only.** Main's provenance requirement says "source-specific provenance" but scenarios only cover npm; the adversary's scenario (git/local records specifier + API + integrity, and SHALL NOT record an npm version) closes the loop.

9. **`broken` status (management list / installation)** — **Main gap.** Main introduces `broken` ("or is otherwise broken") as a compatibility status without defining it anywhere. Its classification requirement defines only missing/malformed/unsupported/supported. Define `broken` (e.g., bundle fails to load or does not export a valid adapter) or drop the word.

## Merge recommendation (per capability)

**`adapter__sdk`** — keep Main as the base.
- Add the adversary's scenario *"API version is independent of package versions"* to Main's ADDED classification requirement (the independence clause currently has no scenario).
- Optional: extract the canonical-export scenario into its own ADDED requirement (adversary's shape) for atomicity; low priority.

**`adapter__management`** — keep Main as the base.
- Split Main's combined "Adapter replacement is atomic and retains repair provenance" into two requirements (adversary's decomposition): one for atomic verified replacement, one for installation provenance. Keep all of Main's scenarios, redistributing them.
- Add the adversary's git/local provenance scenario (records specifier, declared API, integrity; SHALL NOT record a resolved npm version).
- Define `broken` in the status vocabulary or remove it from the list requirement.

**`installation`** — keep Main's aggregation and receipt-awareness.
- **Resolve divergence 6 before archive**: check the design's removal path. If removal is receipt-driven file deletion (as the permanent spec strongly implies), drop the remove-gating clause and the "Removing a facet does not bypass adapter compatibility" scenario, and rename the requirement back toward install/add mutation gating. If removal invokes adapter contract methods, keep Main and note the rationale.
- Add the adversary's positive-path scenario ("Compatible selected adapters install normally").

## Blocking items

1. **Removal gating (divergence 6)** — Main currently blocks facet *removal* on adapter incompatibility, in tension with the permanent installation spec's always-available, receipt-driven removal. Must be settled against the design before this change is archived.
2. **Undefined `broken` classification (divergence 9)** — used normatively in two capability files but defined nowhere; either define it or remove it.

Everything else is additive polish; Main is the stronger base overall.
