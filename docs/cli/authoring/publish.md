---
title: facet publish
sidebarTitle: publish
description: Verify a built facet and upload it to the registry
tag: facet publish
---

## Usage

```sh
facet publish [directory]
```

Reads the built `.facet` archive from `dist/`, verifies it against the facet artifact specification, and uploads it to the registry. The directory defaults to the current working directory. Publish is a verify-and-ship step, not a build -- `facet build` is the sole producer of the `.facet` archive.

## What it does

1. **Resolve directory.** Defaults to the current working directory. The directory must contain a `facet.json`.
2. **Resolve credential.** Checks `FACET_TOKEN` environment variable first, then the credentials file at `~/.facet/credentials`. Fails before any further work if no credential is found.
3. **Validate manifest.** Loads and validates the source-tree `facet.json` against the schema.
4. **Discover dist/ artifact.** Finds the `.facet` file in `dist/`. If `dist/` contains multiple `.facet` files, publish fails -- run `facet build` to prune `dist/` or remove the extras manually.
5. **Drift detection.** Compares the built artifact's embedded manifest against the current source-tree `facet.json`. See [Drift detection](#drift-detection) below.
6. **Re-verify archive.** Runs full archive verification: integrity hash, per-asset hashes, embedded manifest, and content rules. The archive is verified immediately before upload regardless of whether earlier steps already verified it.
7. **Upload.** POSTs the verified bytes to the registry. The `name` and `version` used to address the upload come from the verified artifact's embedded manifest, not from a separate parse of the source-tree `facet.json`.

## Credential resolution

The CLI resolves the publish token from, in order of precedence:

1. `FACET_TOKEN` environment variable (preferred for CI and scripted use).
2. Credentials file at `$FACET_DIR/credentials` (default `~/.facet/credentials`), written by `facet login` with mode `0600`.

If no token is found, publish fails before any verification or registry round-trip.

## Drift detection

When `dist/` contains a `.facet` whose embedded manifest disagrees with the current source-tree `facet.json`, publish handles four scenarios:

| Scenario        | Description | Interactive behavior | Non-interactive behavior |
| --------------- | ----------- | -------------------- | ------------------------ |
| No artifact     | `dist/` is empty or missing. | Offers to build the current source. | Fails with "run `facet build` first". |
| In sync         | Embedded manifest matches source. | Uploads directly. | Uploads directly. |
| Content drift   | Same name and version, different content. | Two-option prompt: rebuild and publish, or publish existing. | Warns to stderr, ships existing. |
| Identity drift  | Different name or version. | Three-option prompt: build and publish current source, publish existing under its own identity, or cancel. | Warns to stderr, ships existing. |

## Publish outcomes

| HTTP status | CLI exit | Meaning |
| ----------- | -------- | ------- |
| `201`       | `0`      | Published immediately. |
| `202`       | `0`      | Queued for review. The CLI reports that the submission was accepted and surfaces the registry's guidance. |
| `409`       | `1`      | Version already exists. The registry enforces immutability -- a version cannot be republished with different content. |

<Note>
Registry errors are rendered verbatim -- the CLI shows the registry's own message and suggested fix rather than maintaining its own copy of what each error code means.
</Note>

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Publish succeeded (201 published or 202 queued). |
| `1`  | Failed (no credential, invalid manifest, verification failure, no artifact in non-TTY, registry error, etc.). |

## See also

- [`facet build`](/cli/authoring/build) -- produce the `.facet` archive that publish uploads.
- [`facet login`](/cli/login) -- sign in to the registry.
- [`facet whoami`](/cli/whoami) -- verify the signed-in identity.
- [Publish Flow specification](/specification/publish) -- the normative specification for building and publishing.
