- The release/commands directory contains single-file symlinks to the development/commands/* files
- When creating new commands, write them to the development/commands directory, then make a symlink in release/commands
- `release/@config.yml` is a symlink to `development/@config.yml` — edits to either land in both packed configs. The `parameters.package` block lives here for this reason; it's consumed only by the release workflow's `serial-group` but declared in both packed outputs, which is harmless (CircleCI ignores unused declared parameters).

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
