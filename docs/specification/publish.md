---
title: "Publish Flow"
description: "How facets are built and published to the registry."
---

This page defines what happens during `facet build` and `facet publish` — the steps, inputs, outputs, and integrity guarantees. This covers facet archives only. MCP server publishing is defined in [MCP Server Assets](/specification/servers).

The publish flow addresses two concerns:

1. **Text composition** — the `facets` section in the manifest references other facets. The composed text MUST be included in the published archive so that consumers receive a self-contained artifact.

2. **Composition integrity** — if the author uploads a pre-assembled archive, they could tamper with composed files while the manifest still attributes the content to trusted sources. This is a supply chain attack on AI context.

## Build (Local Preview)

`facet build` produces a local archive for testing and inspection. This is a preview — not the artifact of record.

### Steps

1. **Parse the manifest.** Read the facet manifest (`facet.json`) and validate against the manifest schema. The manifest MUST be valid. Invalid manifests MUST be rejected with a descriptive error. Content files MUST NOT be empty. YAML front matter in content files is permitted and MUST be preserved verbatim in the archive — the manifest's `name`, `description`, and any per-adapter extras are merged on top of the author's front matter at install time.

2. **Resolve text composition.** For each entry in the `facets` section:
   - Fetch the referenced facet at the exact pinned version from the registry or local cache.
   - For compact entries (`"name@version"`): extract all text assets and their files.
   - For selective entries: extract only the named assets and their files.
   - Detect naming collisions between composed assets and locally authored assets. Collisions MUST be a build error.

3. **Validate adapter metadata.** For each agent with an `adapters` section, validate the adapter-specific metadata against each installed adapter's schema. Unknown adapters SHOULD produce a warning. Invalid metadata for an installed adapter MUST be a build error.

4. **Validate server references.** For each entry in the `servers` section, verify that the named server exists in the registry. Missing servers SHOULD produce a warning, not an error — the server MAY not yet be published.

5. **Package the local archive.** Create the archive containing the manifest, all locally authored files, and all composed files. This is for local testing only.

The author MAY inspect the local archive, test it, and iterate before publishing.

## Publish (To Registry)

`facet publish` uploads the author's work to the registry. The registry assembles the canonical archive.

`facet publish` accepts an optional directory argument and defaults to the current working directory, consistent with `facet build`, `facet edit`, and `facet create`:

```bash
facet publish            # publish the facet in the current directory
facet publish ./cowsay   # publish the facet in ./cowsay
```

### Authentication

Publishing is an authenticated operation. The CLI sends an `Authorization: Bearer <token>` header on the publish request, where the token is a personal access token (PAT) minted in the web UI. The CLI resolves the token from, in order of precedence:

1. The `FACET_TOKEN` environment variable (preferred for CI and scripted use).
2. A credentials file written by `facet login`, stored under `$FACET_DIR` (default `~/.facet/credentials`, mode `600`).

If no token can be resolved, `facet publish` fails before packing or contacting the registry, directing the user to sign in.

There are three commands for managing the credential:

| Command         | What it does                                                                                                   |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| `facet login`   | Guided sign-in: paste a PAT, which is verified against the registry and then saved to the credentials file.     |
| `facet whoami`  | Print the signed-in identity (username, email, tier). Indicates when `FACET_TOKEN` is the active credential.    |
| `facet logout`  | Remove the saved credentials file. Makes no server call — revoke PATs in the web UI.                            |

When `FACET_TOKEN` is set, it takes precedence over the saved file; `login` and `logout` both note this so the env var does not silently shadow the file. Read-only commands (such as `facet search` and `facet add`) send the token too when one is available — earning a higher rate-limit tier — but work anonymously when it is absent.

<Note>
  Errors returned by the registry are rendered verbatim — the CLI shows the registry's own message and suggested fix rather than maintaining its own copy of what each error code means. A duplicate-version publish, for example, surfaces the registry's "version already exists" guidance directly.
</Note>

### What the Author Uploads

- The facet manifest — unmodified
- All locally authored text asset files (skills, agent prompts, command prompts)

Composed files MUST NOT be uploaded by the author. This is the key security property.

### What the Registry Does

1. **Validate the manifest.** Parse the facet manifest and validate against the schema. Invalid manifests MUST be rejected.

2. **Resolve text composition server-side.** For each entry in the `facets` section, the registry MUST fetch the referenced facet from its own storage — a trusted source. It extracts the composed assets and their files exactly as the local build would. Because the registry resolves composition from its own artifact store, the author cannot tamper with composed content.

3. **Detect naming collisions.** Composed asset names MUST NOT collide with locally authored asset names. Collisions MUST reject the publish.

4. **Assemble the canonical archive.** The registry creates the facet archive containing:
   - The facet manifest — unmodified
   - All locally authored text asset files (from the author's upload)
   - All composed text asset files (from the registry's own resolution)

5. **Compute the content hash.** The registry MUST compute a SHA-256 hash of the assembled archive (see [Integrity Model](/specification/integrity)).

6. **Store the artifact.** The registry stores the archive and content hash. Both MUST be available for download and verification by consumers.

### Review Queue

A first-time publish of a reserved or over-budget global facet MAY be accepted into a moderation queue rather than published immediately. This is a **success** outcome: `facet publish` reports that the submission was queued for review, renders the registry's guidance, and exits 0. The version becomes available once an admin approves it.

### Immutability

Once a facet version is published, the registry MUST NOT allow re-publishing the same name and version with different content. A version, once published, is immutable.

## Publish Mechanisms

Two mechanisms are defined for getting the author's work to the registry:

### Direct Upload

The author runs `facet publish` locally. The CLI uploads the manifest and locally authored files. The registry assembles the archive server-side.

### Git-Linked Pull

The author registers a Git repository URL with the registry. On publish trigger (tag, webhook, or manual), the registry clones the repository at the specified ref, extracts the manifest and locally authored files, and assembles the archive server-side. The registry uses only the manifest and locally authored files from the clone — composed content comes from its own storage.

Both mechanisms MUST produce the same result: a canonical archive assembled by the registry with verified composition.

## Build vs. Publish

| Concern               | `facet build` (local)             | `facet publish` (registry)                   |
| --------------------- | --------------------------------- | -------------------------------------------- |
| Who assembles         | The CLI                           | The registry                                 |
| Composition source    | Registry or local cache           | Registry's own artifact store                |
| Output                | Local archive for testing         | Canonical archive stored in registry         |
| Integrity guarantee   | None (local preview)              | Composed content matches attributed sources  |
| Manifest modification | None                              | None                                         |

## Why Server-Side Composition

If the author uploads a pre-assembled archive (including composed files), they could replace composed content with malicious prompts while the manifest still attributes the content to trusted sources. The `facets` section would claim "this skill came from `trusted-base@1.0.0`" but the actual file could contain anything.

Server-side composition eliminates this attack. The registry fetches composed content from its own storage — the same storage that the original facet author published to. The content is guaranteed to match the attribution.

## Not in the Publish Flow

- **MCP server resolution** — server references in `servers` are stored as declared. They are resolved at install time (see [Install & Resolve](/specification/install)).
- **MCP server publishing** — servers are a separate artifact type with their own publish flow (see [MCP Server Assets](/specification/servers)).
- **Lockfile generation** — the lockfile is an install-time artifact, not a publish-time artifact.
