---
title: "Install & Resolve"
description: "How facets are installed, server references resolved, and everything pinned in a lockfile."
---

## Closed alpha (current behavior)

`facet add` and `facet install` share a single install pipeline. `facet add`
is the entry point for declaring a new facet; `facet install` reapplies the
existing manifest. Both run the same flow internally.

1. **Parse source.** `facets.json` maps facet names → source specifiers.
   Accepted forms: registry names (`name`, `name@1.2.3`, `name@1.*`,
   `name@latest`), `github:owner/repo[#ref]`, plain `https://...git[#ref]`,
   SCP-style `git@host:owner/repo[#ref]`, and local paths (with optional
   `file:` prefix). The legacy `git+` prefix is hard-rejected. Version
   specs are restricted to `*`, `MAJOR.*`, `MAJOR.MINOR.*`,
   `MAJOR.MINOR.PATCH`, and `latest`; caret/tilde/comparator/OR/x-style
   ranges are rejected.

2. **Honor the lockfile.** If `facets.lock` already pins a facet, that
   exact version is fetched without re-resolving the manifest range. If
   no lockfile exists, one is bootstrapped on first run (bun-style).
   Manifest entries without a lockfile entry resolve fresh.

3. **Reject composition; warn on servers.** A source `facet.json` with a
   non-empty `facets: [...]` is hard-rejected. A `servers:` declaration
   produces a warning naming each declared server but otherwise lets the
   install proceed — server materialization is open-beta scope.

4. **Cache lookup.** Resolved content is keyed by `<name>@<version>` (or
   `<name>@<commit>` for git, `<name>@local-<hash>` for local) under
   `~/.facets/cache/`. The cache root can be overridden with the
   `FACETS_CACHE_DIR` environment variable. Cached content is treated as
   trusted — never re-hashed on read.

5. **Verify integrity.** Before any asset is written:
   - **Registry sources** run a three-check protocol: cache vs. registry
     metadata, archive manifest vs. registry metadata, computed content
     vs. archive manifest. Each check defends against a distinct
     adversary (split-brain registry, retroactive metadata mutation,
     tampered archive).
   - **Git sources** run a single check: computed content vs. lockfile
     integrity, defending against tag-move attacks.
   - **Local sources** are trust-by-path; no hash check.
   Any mismatch is a hard security error: the install aborts before any
   asset is written, the project state is unchanged.

6. **Compute diff.** Compare the new asset set (from the build) against
   the prior lockfile entry. Assets present in OLD but not in NEW are
   deleted from every selected adapter (drift-proof convergence).

7. **Materialize, with skip-if-identical.** For each asset, the
   installer reads the on-disk content and metadata. If they already
   match what we would write, the asset is skipped (no journal entry
   recorded). Otherwise the adapter's `installAsset` is called and the
   inverse op is journaled. The installer enforces the `supportsInstall`
   capability flag at runtime; adapters without it cause the run to
   fail loud rather than silently no-op.

8. **Classify outcomes.** Each facet is reported as one of:
   `installed` (new entry), `updated` (different version),
   `repaired` (same version, but at least one on-disk asset had drifted
   and was restored), `unchanged` (no writes), or `removed` (dropped
   from `facets.json`).

9. **Write the lockfile.** `facets.lock` records
   `{source, ref, commit, version, integrity, assets: [{scope, type, name}]}`
   per facet. Adapter-agnostic by design — the same asset set is
   applied to every selected adapter.

`facet install` rejects positional arguments — to add a new facet, use
`facet add`. There is no `--dry-run` flag; both commands always commit.

If any adapter errors mid-install, the installer triggers best-effort
rollback of the journal (inverse ops in LIFO order). SIGINT triggers
the same path via an internal AbortController. A failure during
rollback is reported and the run exits non-zero; re-running
`facet install` reconverges from whatever partial state remains. When
`facet add` is the caller, `facets.json` is also restored byte-for-byte
on any failure so the project is exactly as it was before the command.

## Open-beta target (future)

This page defines what happens during `facet install` and `facet upgrade` — how facet archives are downloaded, text assets are extracted, server references are resolved, and everything is pinned in a lockfile.

The install flow has two distinct resolution paths:

1. **Text** — already resolved. The facet archive is self-contained (composed by the registry at publish time). No text resolution at install time.
2. **MCP servers** — references that MUST be resolved to specific versions at install time.

## Install

### Inputs

A facet name (or name@version) to install.

### Steps

1. **Download the facet archive.** Query the registry for the facet at the requested version (or latest if no version specified). Download the archive. Verify the content hash against the registry's recorded hash (see [Integrity Model](/specification/integrity)). A hash mismatch MUST be a hard failure — the archive MUST be rejected.

2. **Read the manifest.** Parse the facet manifest from the archive.

3. **Present text assets for review.** Implementors SHOULD show the consumer a summary of all text assets to be installed. The consumer SHOULD be able to inspect any individual asset before accepting. If an asset with the same name already exists on disk (collision), the consumer MUST be presented with options to resolve it: accept the facet's version, keep the existing content as an override, or create a new override.

4. **Install text assets.** Extract the archive's text assets (skills, agent prompts, command prompts — both locally authored and composed) into the provider-specified install directories according to the consumer's decisions from the review step. No resolution is needed — the archive is self-contained.

5. **Resolve MCP server references.** For each entry in the `servers` section:

   **Source-mode** (string value — floor version):
   - Query the registry for the latest version of the named server at or above the floor constraint.
   - Download the server artifact.
   - Verify the server artifact's content hash.
   - Compute the server's API surface hash for future breaking-change detection.

   **Ref-mode** (object value — OCI image):
   - Resolve the OCI image tag to a digest by querying the OCI registry. If the reference is already a digest, use it as-is.
   - Pin the resolved digest in the lockfile.
   - Compute the server's API surface hash for future breaking-change detection.

   Resolution is always one level deep. MCP servers are terminal — they MUST NOT declare dependencies on other servers. There is no transitive resolution.

6. **Write the lockfile.** Record the exact resolved versions and integrity hashes:

   ```yaml
   # facets.lock
   facet:
     name: acme-dev
     version: "1.0.0"
     integrity: "sha256:abc123..."

   servers:
     # Source-mode server
     jira:
       version: "1.5.2"
       integrity: "sha256:def456..."
       api_surface: "sha256:789abc..."
     github:
       version: "2.4.0"
       integrity: "sha256:ghi012..."
       api_surface: "sha256:345def..."
     # Ref-mode server
     slack:
       image: "ghcr.io/acme/slack-bot:v2"
       digest: "sha256:e4d909..."
       api_surface: "sha256:567ghi..."
   ```

7. **Configure servers for the active adapter.** For each resolved server, generate the adapter-specific configuration needed to start the server (e.g., MCP server config entries for the active AI assistant). Configuration details are handled by the installed adapters.

## Lockfile-First Installs

If a lockfile already exists, `facet install` MUST use the pinned versions instead of resolving from the registry. This ensures reproducible installs across team members and environments.

Only `facet upgrade` resolves newer versions.

The lockfile SHOULD be version-controlled so that all team members and CI environments get the same versions.

## Upgrade

`facet upgrade` checks for newer facet versions and newer MCP server versions in a single interactive flow.

### Steps

1. **Read the lockfile and manifest.** Load the currently pinned facet version and server versions.

2. **Check for updates.**
   - **Facet**: Query the registry for the latest version of the installed facet. A newer version MAY contain updated composed text, new server references, changed server floor constraints, or new local content.
   - **Source-mode servers**: Query the registry for the latest version at or above the floor constraint.
   - **Ref-mode servers**: Re-resolve the OCI tag to check for a newer digest.

3. **Detect API surface changes.** For each server with a newer version:
   - Download the new server artifact and compute its API surface hash.
   - Compare to the API surface hash in the lockfile.
   - If unchanged — the upgrade is structurally safe.
   - If changed — a structural change occurred. The consumer MUST be warned about structural changes.

4. **Present available updates.** Implementors MUST surface text asset changes to the consumer:
   - **Text assets**: For each text asset that changed, show the diff. For new assets, show their content. For removed assets, flag the removal. The consumer gets accept/reject/modify for changed and new assets, and accept/reject for removed assets.
   - **Servers**: Show API surface change status for each server.
   The consumer controls which updates to apply.

5. **Apply selected updates.**
   - If the facet version changed: download the new archive, verify integrity, extract text assets according to the consumer's decisions from the change resolution flow. Re-resolve any server references that have new floor constraints.
   - If server versions changed: download new server artifacts, verify integrity, update adapter configuration.

6. **Write the updated lockfile.** Record the new versions, content hashes, and API surface hashes for all updated artifacts.

## Uninstall

`facet uninstall` removes a facet and its managed assets.

### Steps

1. **Read the lockfile.** Identify all managed assets belonging to the facet.

2. **Present assets for removal.** Implementors SHOULD show the consumer a summary of all text assets and server configurations that will be removed. For each asset, the consumer can accept the removal or reject it (keep as unmanaged). There is no modify option — the facet no longer owns the asset.

3. **Remove accepted assets.** Delete text assets the consumer accepted for removal from the provider-specified install directories. Remove server configurations.

4. **Update the lockfile.** Remove the facet entry and all its managed asset records. Assets kept by the consumer are not recorded in the lockfile — they are now unmanaged.

## Lockfile Semantics

The lockfile (`facets.lock`) pins the exact state of an installation:

| Field                        | Description                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `facet.name`                 | The installed facet name.                                                           |
| `facet.version`              | The exact installed facet version.                                                  |
| `facet.integrity`            | Content hash of the facet archive.                                                  |
| `servers.<name>.version`     | Source-mode: the exact resolved server version.                                     |
| `servers.<name>.integrity`   | Source-mode: content hash of the server artifact.                                   |
| `servers.<name>.image`       | Ref-mode: the OCI image reference (tag or digest) from the manifest.                |
| `servers.<name>.digest`      | Ref-mode: the resolved OCI digest pinned at install time.                           |
| `servers.<name>.api_surface` | API surface hash at install time — the baseline for change detection (both modes).  |

## Not in the Install Flow

- **Text asset resolution** — text is already in the archive. No install-time fetching of composed facets.
- **Transitive server resolution** — servers are terminal. No multi-level dependency resolution.
- **Local disk layout specifics** — where files are placed on disk is determined by the installed adapters. Directory mapping is a CLI concern, not a specification-level decision.
