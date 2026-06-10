---
title: Publish a Facet
description: Build, authenticate, and publish your facet to the registry
---

This guide covers the end-to-end flow for publishing a facet to the registry: signing in, building, publishing, and handling the various outcomes.

## Prerequisites

- A facet project with a valid `facet.json` and at least one text asset. See [Create Your First Facet](/guides/create-your-first-facet) if you need to scaffold one.
- A registry account. Sign up at [facet.cafe](https://facet.cafe) and create a personal access token (PAT) from your account settings.

## Sign in

<Steps>

<Step title="Run facet login">

```sh
facet login
```

The login flow presents an interactive menu. Select "Paste a token", then paste the PAT you created in the web UI.

The token is verified against the registry (`GET /v0/auth/me`) before it is saved. A typo or expired token fails immediately with the registry's own error message, and you are reprompted rather than left with an unusable credential.

On success, the token is persisted to `~/.facet/credentials` with mode `0600`.
</Step>

<Step title="Verify your identity">

```sh
facet whoami
```

Expected output:

```
yourname <you@example.com>
  tier: free
```

If the credential was resolved from the `FACET_TOKEN` environment variable instead of the saved file, an additional line appears:

```
  credential: FACET_TOKEN (environment)
```
</Step>

</Steps>

## Build

Build your facet before publishing. If you have not built yet, or if your source has changed since the last build:

```sh
facet build
```

See the [build command reference](/cli/authoring/build) for details on the 6-stage pipeline. The build writes `dist/<name>-<version>.facet`.

## Publish

```sh
facet publish
```

The publish command runs a 7-step pipeline:

1. **Resolve directory** -- defaults to the current working directory.
2. **Resolve credential** -- checks `FACET_TOKEN` env, then `~/.facet/credentials`. Fails before any work if no credential is found.
3. **Validate manifest** -- loads and validates the source-tree `facet.json`.
4. **Discover dist/ artifact** -- finds the `.facet` file in `dist/`.
5. **Drift detection** -- compares the built artifact's embedded manifest against the current source-tree `facet.json`. See [Drift detection](#drift-detection) below.
6. **Re-verify archive** -- runs full archive verification (integrity hash, per-asset hashes, embedded manifest).
7. **Upload** -- POSTs the verified bytes to the registry using the artifact's embedded `name` and `version`.

### Drift detection

When the built artifact and the source-tree `facet.json` disagree, `facet publish` distinguishes two cases:

**Content drift** -- same name and version, different manifest content (you edited a description or asset descriptor without rebuilding). In an interactive terminal, you get two options: rebuild and publish, or publish the existing artifact unchanged.

**Identity drift** -- different name or version (the most common case: you bumped `version` in `facet.json` but `dist/` still has the old build). In an interactive terminal, you get three options:

1. Build and publish the current source.
2. Publish the existing artifact under its own embedded identity.
3. Cancel.

In a non-interactive context (CI, piped stdin), both drift classes warn to stderr and ship the existing artifact unchanged. For strict CI builds, run `facet build && facet publish` as two separate commands.

## Publish outcomes

| HTTP status | Meaning |
| ----------- | ------- |
| `201`       | Published immediately. The facet is live in the registry. |
| `202`       | Queued for review. The CLI reports the submission was accepted and surfaces the registry's guidance. The version becomes available once an admin approves it. |
| `409`       | Version already exists. The registry enforces immutability. Once a version is published, it cannot be republished with different content. |

<Note>
Registry errors are rendered verbatim. The CLI shows the registry's own message and suggested fix rather than maintaining its own copy of what each error code means.
</Note>

## Update and republish

To publish a new version:

1. Bump the `version` field in `facet.json`.
2. Rebuild: `facet build`.
3. Republish: `facet publish`.

If you forget to rebuild after bumping the version, publish detects the identity drift and offers to build for you (in an interactive terminal).

## Sign out

```sh
facet logout
```

This deletes the `~/.facet/credentials` file. No server call is made. Token revocation is done in the web UI.

<Warning>
If `FACET_TOKEN` is set in your environment, it continues to authenticate every command after logout. Run `unset FACET_TOKEN` to fully sign out of the current shell.
</Warning>

## Environment variables

| Variable             | Description |
| -------------------- | ----------- |
| `FACET_TOKEN`        | Registry personal access token. Takes precedence over the credentials file. Use this for CI pipelines. |
| `FACET_REGISTRY_URL` | Override the registry base URL. Defaults to the production registry. |
