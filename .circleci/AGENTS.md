- The release/commands directory contains single-file symlinks to the development/commands/* files
- When creating new commands, write them to the development/commands directory, then make a symlink in release/commands
- `release/@config.yml` is a symlink to `development/@config.yml` — edits to either land in both packed configs. The `parameters.package` block lives here for this reason; it's consumed only by the release workflow's `serial-group` but declared in both packed outputs, which is harmless (CircleCI ignores unused declared parameters).

## Required contexts

### `github` — required for every job that uses `setup-mise`

Every job that runs the `setup-mise` command MUST attach the `github` org-level context. The
context provides a single env var, `MISE_GITHUB_TOKEN`, which mise auto-discovers (priority 1
in mise's [token resolution chain][mise-tokens]) and uses to authenticate against the GitHub
REST API when resolving and downloading tool releases. Without it, mise falls back to
unauthenticated requests, which CircleCI's shared IP pool burns through GitHub's 60-req/hour
unauthenticated rate limit. With it, the limit is 5,000 req/hour per token.

[mise-tokens]: https://mise.en.dev/dev-tools/github-tokens.html

| Workflow      | Job                      | Requires `github` context? |
|---------------|--------------------------|----------------------------|
| `ci`          | `check`                  | yes                        |
| `ci`          | `registry-compatibility` | yes                        |
| `ci`          | `main-pipeline`          | yes                        |
| `release`     | `release`                | yes                        |
| `release-cli` | `build-cli`              | yes                        |
| `release-cli` | `publish-platform`       | yes                        |
| `release-cli` | `finalize-cli`           | yes                        |

If a future job adds `setup-mise` without attaching the `github` context, it will fail loudly
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

## Caches

Three CircleCI caches keep CI from redownloading the same binaries and
artifacts on every job. All live in the shared `setup-mise` command, so every
job that calls it benefits.

| Cache         | Key                                                                                   | Paths                                                       | Defined in                            |
|---------------|---------------------------------------------------------------------------------------|------------------------------------------------------------|---------------------------------------|
| mise tools    | `v1-mise-{{ .Environment.MISE_ENV }}-{{ checksum "mise.toml" }}-{{ checksum "mise.development.toml" }}` | `~/.local/share/mise/installs`, `~/.local/share/mise/downloads` | `commands/setup-mise.yml`            |
| facets        | `v1-facet-{{ checksum "facets.lock" }}`                                                | `~/.facet/cache`                                            | `commands/setup-mise.yml`             |
| bun deps      | `v1-deps-{{ checksum "bun.lock" }}`                                                    | `node_modules`, `~/.bun/install/cache`                     | `commands/setup-mise.yml`             |

### Why each key is shaped this way

- **mise tools** — keyed on `MISE_ENV` because mise loads different config
  files per env. With no `MISE_ENV` (CI jobs), mise loads `mise.toml` **and**
  `mise.development.toml`, so the toolset includes `circleci`. With
  `MISE_ENV=release` (the `build-cli`, `publish-platform`,
  `finalize-cli` jobs), mise loads **only** `mise.toml` — no `circleci`.
  Namespacing the key by `MISE_ENV` keeps the two toolsets in separate cache
  slots so a release job never restores (or saves) a CI-shaped cache. Both
  toml checksums are in the key so a bump to either file invalidates it. The
  restore happens before `mise install`, which becomes a near-instant no-op on
  a hit. (`mise.local.toml` is gitignored and absent in CI, so it's excluded
  from the key.)
- **facets** — keyed on `facets.lock`, not `facets.json`. `facets.json` can
  reference a mutable git source (`viper-plans` tracks `#main`); the lockfile
  records the resolved commit, so when `#main` moves, `facets.lock` changes and
  the cache invalidates correctly. Pinned facets (e.g. `cowsay`) stay cached.

When changing a cache's paths or invalidation inputs, bump the key's version
prefix (`v1-` → `v2-`, etc.) so stale entries are retired rather than reused.

## Pipelines

Two packed CircleCI configs, one per pipeline dir.

### `development/` — CI

PR-time checks. Workflows: `ci` (runs `check` and `registry-compatibility` on non-main branches, runs `main-pipeline` on main).

`registry-compatibility` is the live-registry type-compatibility job: it
fetches the deployed registry's OpenAPI spec (network dependency), regenerates
the engine's registry types in the ephemeral checkout, and runs
`bun turbo types` across the whole monorepo (hence the `turbo-cache` context
in addition to `github`). It fails when the live schema is unevaluable
(fetch/validate/codegen error) or when any type check fails — never on
snapshot age or diffs against the committed generated files, which are
discarded with the checkout.

### `release/` — CD

Everything that ships. Two workflows:

| Workflow      | Trigger                             | Purpose                                  |
|---------------|-------------------------------------|------------------------------------------|
| `release`     | `@agent-facets/<pkg>@<version>` tag | Publish one library/adapter package      |
| `release-cli` | `agent-facets@<version>` tag        | Build + publish 12 CLI platform packages |

## Serial groups

The main-branch / release top-level jobs that must queue are assigned a `serial-group` so they queue against their own kind. PR-time work such as `ci`'s `check` job is not serialized. Same-kind runs serialize; different kinds do not interfere. All groups are scoped with `<< pipeline.project.slug >>` so they stay per-project inside the org.

| Workflow      | Job             | serial-group                                                            |
|---------------|-----------------|-------------------------------------------------------------------------|
| `ci`          | `main-pipeline` | `<< pipeline.project.slug >>/main-pipeline`                             |
| `release`     | `release`       | `<< pipeline.project.slug >>/release/<< pipeline.parameters.package >>` |
| `release-cli` | `build-cli`     | `<< pipeline.project.slug >>/release-cli-build`                         |
| `release-cli` | `finalize-cli`  | `<< pipeline.project.slug >>/release-cli-finalize`                      |

Notes:

- The `release` group keys on the `package` pipeline parameter so different packages (`core`, `adapter`, …) can release in parallel while repeat releases of the same package serialize. `scripts/release/tag.ts` parses the package name out of the tag and forwards it via the CircleCI API v2 trigger. The parameter is declared in `release/@config.yml` with a default of `""` — which applies to the `release-cli` trigger path that doesn't set it. Required because the serial-group charset (`[A-Za-z0-9._\-/]`) excludes `@`, so we can't embed the raw tag string.
- `release-cli` uses **two distinct** group names (`release-cli-build` and `release-cli-finalize`). CircleCI's docs explicitly warn against reusing  the same `serial-group` value on multiple jobs in a single workflow.
- `publish-platform` intentionally has no `serial-group`. Each matrix variant publishes a distinct platform package, so parallel runs are safe, and adding it would spawn 12 separate queues.
- Pipeline-number priority: if a newer pipeline enters a serial group while an older one is still waiting, the older one is skipped. This matches the behavior we want for deploys and releases — newer always wins.
