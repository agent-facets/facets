- The release/commands directory contains single-file symlinks to the development/commands/* files
- When creating new commands, write them to the development/commands directory, then make a symlink in release/commands
- `release/@config.yml` is a symlink to `development/@config.yml` — edits to either land in both packed configs. The `parameters.package` block lives here for this reason; it's consumed only by the release workflow's `serial-group` but declared in both packed outputs, which is harmless (CircleCI ignores unused declared parameters).

## Required contexts

### `github` — required for every job that uses `setup-env`

Every job that runs the `setup-env` command MUST attach the `github` org-level context. The
context provides a single env var, `MISE_GITHUB_TOKEN`, which mise auto-discovers (priority 1
in mise's [token resolution chain][mise-tokens]) and uses to authenticate against the GitHub
REST API when resolving and downloading tool releases. Without it, mise falls back to
unauthenticated requests, which CircleCI's shared IP pool burns through GitHub's 60-req/hour
unauthenticated rate limit. With it, the limit is 5,000 req/hour per token.

[mise-tokens]: https://mise.en.dev/dev-tools/github-tokens.html

| Workflow      | Job                | Requires `github` context? |
|---------------|--------------------|----------------------------|
| `ci`          | `check`            | yes                        |
| `ci`          | `main-pipeline`    | yes                        |
| `release`     | `release`          | yes                        |
| `release-cli` | `build-cli`        | yes                        |
| `release-cli` | `publish-platform` | yes                        |
| `release-cli` | `finalize-cli`     | yes                        |
| `deploy`      | `deploy-site`      | yes                        |

If a future job adds `setup-env` without attaching the `github` context, it will fail loudly
on the `Install tools` step with `mise WARN GitHub rate limit exceeded` once CircleCI's IP
pool exhausts the unauthenticated budget. That failure is the documented detection mechanism
— add `- github` to the job's `context:` list to fix.

#### Token shape and rotation

- **Type**: classic personal access token (PAT).
- **Scopes**: **none** — every checkbox must be unchecked. Mise only reads public release
  metadata; granting any scope is gratuitous attack surface.
- **Owner**: a bot/machine GitHub account (or a designated human as fallback).
- **Expiration**: Permanent (ok because of lack of permissions).
- **Storage**: CircleCI org settings → Contexts → `github` → env var `MISE_GITHUB_TOKEN`.
  Never as a project-level env var (would be ambient to every job).

#### Why `MISE_GITHUB_TOKEN`, not `GITHUB_TOKEN`

The release scripts in `scripts/lib/ci.ts` runtime-mint a **GitHub App installation token**
and assign it to `process.env.GITHUB_TOKEN` and `process.env.GH_TOKEN` for `gh`-based release
operations (npm publish, tag creation, release notes). That token has real scopes and is
unrelated to the rate-limit fix above.

We deliberately use `MISE_GITHUB_TOKEN` (not `GITHUB_TOKEN`) in the `github` context so the
two paths cannot collide:

- Mise reads `MISE_GITHUB_TOKEN` at priority 1 (mise-only).
- `gh` and the release scripts read `GITHUB_TOKEN` (owned exclusively by the App-token mint).

Renaming the context env var to `GITHUB_TOKEN` would risk silently poisoning `gh`/script
operations with the scopeless PAT in any job where `mintGithubTokens()` hasn't yet run.

## Pipelines

Two packed CircleCI configs, one per pipeline dir.

### `development/` — CI

PR-time checks. Workflows: `ci` (runs `check` on non-main branches, runs `main-pipeline` on main).

### `release/` — CD

Everything that ships. Three workflows:

| Workflow      | Trigger                             | Purpose                                  |
|---------------|-------------------------------------|------------------------------------------|
| `release`     | `@agent-facets/<pkg>@<version>` tag | Publish one library/adapter package      |
| `release-cli` | `agent-facets@<version>` tag        | Build + publish 12 CLI platform packages |
| `deploy`      | push to `main`                      | `sst deploy --stage main`                |

## Serial groups

The main-branch / deploy / release top-level jobs that must queue are assigned a `serial-group` so they queue against their own kind. PR-time work such as `ci`'s `check` job is not serialized. Same-kind runs serialize; different kinds do not interfere. All groups are scoped with `<< pipeline.project.slug >>` so they stay per-project inside the org.

| Workflow      | Job             | serial-group                                                            |
|---------------|-----------------|-------------------------------------------------------------------------|
| `ci`          | `main-pipeline` | `<< pipeline.project.slug >>/main-pipeline`                             |
| `deploy`      | `deploy-site`   | `<< pipeline.project.slug >>/deploy-site`                               |
| `release`     | `release`       | `<< pipeline.project.slug >>/release/<< pipeline.parameters.package >>` |
| `release-cli` | `build-cli`     | `<< pipeline.project.slug >>/release-cli-build`                         |
| `release-cli` | `finalize-cli`  | `<< pipeline.project.slug >>/release-cli-finalize`                      |

Notes:

- The `release` group keys on the `package` pipeline parameter so different packages (`core`, `adapter`, …) can release in parallel while repeat releases of the same package serialize. `scripts/release/tag.ts` parses the package name out of the tag and forwards it via the CircleCI API v2 trigger. The parameter is declared in `release/@config.yml` with a default of `""` — which applies to the `release-cli` trigger path that doesn't set it. Required because the serial-group charset (`[A-Za-z0-9._\-/]`) excludes `@`, so we can't embed the raw tag string.
- `release-cli` uses **two distinct** group names (`release-cli-build` and `release-cli-finalize`). CircleCI's docs explicitly warn against reusing  the same `serial-group` value on multiple jobs in a single workflow.
- `publish-platform` intentionally has no `serial-group`. Each matrix variant publishes a distinct platform package, so parallel runs are safe, and adding it would spawn 12 separate queues.
- Pipeline-number priority: if a newer pipeline enters a serial group while an older one is still waiting, the older one is skipped. This matches the behavior we want for deploys and releases — newer always wins.
