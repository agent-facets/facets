- The release/commands directory contains single-file symlinks to the development/commands/* files
- When creating new commands, write them to the development/commands directory, then make a symlink in release/commands

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
