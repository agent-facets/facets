## Why

A user who hears about a facet has no way to learn what it does from the terminal. `facet search` prints one line per match (name, version, author, asset counts). `facet list` prints only names and versions. To learn what a facet's skills do, which MCP servers it connects to, or what a command says, the user must open the registry website or install the facet and look through the files.

Agent Facets is meant to keep the user in their own environment, reading the real files that will run on their machine. A facet's description, its asset list, and the full text of each skill, command, and agent are already available. The registry serves them for any version, and the installed copy of each facet is in the local cache. The CLI does not show any of it.

A user who opens an installed facet also cannot see whether it is out of date without running a separate command (`facet outdated`) that reports on every facet in the project.

## What Changes

- The system SHALL provide a read-only `facet info <name>` command. It SHALL print a summary of one facet: name, version, free-text author, description, and every asset grouped by type (skills, commands, agents, MCP servers). Each skill, command, and agent SHALL show its description. Each MCP server SHALL show its transport (`http` or `stdio`) and its URL or command, and SHALL NOT show environment values. Supplementary files (a `README.md`, a skill's companion files) SHALL be listed. For an installed facet, an aliased or omitted asset SHALL say so.
- For each skill, command, agent, and text supplementary file, the summary SHALL print the exact `facet cat` command that prints its content.
- When the facet is installed in the current project, `facet info` SHALL read the installed version from the user's machine. When it is not installed, `facet info` SHALL read the latest published version from the registry. It SHALL tell the user which version it shows, and say how to install the facet if it is not installed.
- For an installed facet with a verified local copy, `facet info` and `facet cat` SHALL NOT contact the registry. `facet info` SHALL point to `facet outdated` for update checks rather than performing one. When the summary is read from the registry (a facet that is not installed), it SHALL also show the verified publisher, which arrives in the same response.
- The system SHALL provide a read-only `facet cat <name> <asset>` command. It SHALL print the full content of one skill, command, agent, or text supplementary file to stdout, with no other output, so the user can read or pipe it. It SHALL use the same source as `facet info`: the installed copy if there is one, otherwise the registry. The selector SHALL follow the facet's file layout: a bare name, a folder-prefixed name (`skills/<n>`, `commands/<n>`, `agents/<n>`), or a file path such as `README.md`.
- Facet text SHALL NOT be able to control the user's terminal. `facet info` SHALL always make control characters, bidirectional overrides, and zero-width characters visible. `facet cat` SHALL do the same when printing to a terminal, and SHALL write raw bytes when output is redirected. Copy-paste hints SHALL be shell-quoted. A `facet cat` selector SHALL never reach a file the facet does not declare. `facet cat --path` SHALL print the location of an installed file without opening it.
- The summary SHALL end with a `WEB:` line giving the facet's page on the Agent Facets website. The CLI SHALL print the link and SHALL NOT open it.
- Documentation SHALL add `docs/cli/info.mdx` and `docs/cli/cat.mdx` and list both commands in the CLI index and navigation.

## Non-goals

- **No machine-readable output.** `--json` is not part of this change. Both commands are for people. `facet cat` output is the raw file and can already be piped.
- **No registry changes.** The registry already serves version metadata (including the full manifest) and per-file contents for public and private facets.
- **No version selection.** `facet info` shows the installed version, or the latest version if the facet is not installed. A `name@version` argument is out of scope.
- **No update check in `info` (v1).** A live check is a side request with its own timing, sign-in, and sandbox problems. `info` points to `facet outdated` instead. An inline `UPDATE AVAILABLE` section is a candidate for a later version.
- **No verified publisher for installed facets (v1).** It is not stored locally; it can return once the lockfile records it.
- **No content for MCP servers.** A server has no file to print. Its transport and URL or command in the summary are the full description.
- **No changes to `facet search` or `facet list` output.**

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cli`: adds requirements for the `info` and `cat` commands: their registration, what the summary shows, where the content comes from (installed copy or registry), the pointer to `facet outdated`, asset selection by type, and the errors for an unknown facet or asset.

## Impact

- **Code:** two new command folders in `packages/cli/src/commands/` (`info`, `cat`), registered in `packages/cli/src/commands.ts`. The commands reuse:
  - the engine's project manifest and lockfile loaders, to find out whether the facet is installed and at which version;
  - the engine's cache, to read the installed copy;
  - the engine's registry metadata resolver, plus a new registry read for version contents (`GET /v0/facets/{name}/{version}/contents`, already in the generated registry contract);
- **Registry:** no changes.
- **Docs:** new `docs/cli/info.mdx` and `docs/cli/cat.mdx`. Updates to `docs/cli/index.mdx`, the CLI group in `docs/docs.json`, and the agent overview prompt (`packages/cli/src/prompts/overview.txt`), so agents learn to inspect a facet before they install it.

### Documentation that informed this proposal

- `docs/cli/search.mdx` and `docs/cli/list.mdx`: what the user sees about a facet today.
- `docs/cli/outdated.mdx` and `docs/cli/update.mdx`: how "out of date" is decided (Current, Target, Latest), and that `facet update` takes no positional arguments.
- `README.md`: the product position of keeping facets inspectable and local.
