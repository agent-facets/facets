## ADDED Requirements

### Requirement: Info command is registered

The system SHALL register an `info` command that takes exactly one facet name and prints a summary of that facet. The command SHALL NOT modify `facets.json`, `facets.lock`, any installed asset, or any adapter configuration.

#### Scenario: Info command is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list the `info` command with its description

#### Scenario: Info leaves the project unchanged

- **WHEN** a user runs `facet info cowsay` in a project that declares `cowsay`
- **AND** the command completes
- **THEN** the process SHALL exit with code 0
- **AND** `facets.json` and `facets.lock` SHALL remain byte-identical to their state before the command ran

#### Scenario: Info requires exactly one facet name

- **WHEN** a user runs `facet info` with no arguments, or with two or more arguments
- **THEN** the system SHALL write an error to stderr that states the expected usage `facet info <name>`
- **AND** the process SHALL exit with code 1

### Requirement: Info summarizes a facet and its assets

The `facet info` summary SHALL show the facet's name, the version shown, and the facet's description. It SHALL then list every asset of the facet, grouped by type in the order skills, commands, agents, MCP servers. Each group heading SHALL state the number of assets in it. A type with no assets SHALL NOT be shown. Each skill, command, and agent SHALL show its name and description. Each MCP server SHALL show its name, its transport (`http` or `stdio`), and its URL (for `http`) or its command and arguments (for `stdio`). For a `stdio` server, the summary SHALL show each environment variable with the value the facet declares for it, quoted as the paste-safety requirement describes. These values are written by the publisher and passed to the server unchanged, so they are part of what the user reviews.

#### Scenario: Facet with a skill and an HTTP server

- **WHEN** a user runs `facet info mobbin`
- **AND** `mobbin` declares one skill `using-mobbin` and one `http` server `mobbin` at `https://api.mobbin.com/mcp`
- **THEN** stdout SHALL contain the facet's description
- **AND** stdout SHALL contain a `Skills (1)` group that lists `using-mobbin` with its description
- **AND** stdout SHALL contain an `MCP servers (1)` group that lists `mobbin` with `http` and `https://api.mobbin.com/mcp`
- **AND** stdout SHALL NOT contain a commands group or an agents group

#### Scenario: Facet with commands and an agent

- **WHEN** a user runs `facet info cowsay`
- **AND** `cowsay` declares one skill, two commands, and one agent
- **THEN** stdout SHALL show the groups `Skills (1)`, `Commands (2)`, and `Agents (1)`, in that order
- **AND** each listed asset SHALL show its description

#### Scenario: Standard-input server shows its environment

- **WHEN** a facet declares a `stdio` server with `env` `{ "NODE_OPTIONS": "--require ./x.js" }`
- **AND** a user runs `facet info` for that facet
- **THEN** stdout SHALL contain `NODE_OPTIONS='--require ./x.js'`

### Requirement: Info lists supplementary files

The `facet info` summary SHALL list the facet's supplementary files. Each skill's companion files SHALL be listed under that skill. A `Files` group after the asset groups SHALL list the manifest, `facet.json`, followed by the top-level supplementary files (for example `README.md`). Each listed file SHALL show its path relative to the facet root.

#### Scenario: Facet with a README and skill companions

- **WHEN** a facet declares top-level `files` `["README.md"]`
- **AND** its skill `using-chrome-devtools` declares `files` `["references/live-session-safety.md"]`
- **AND** a user runs `facet info` for that facet
- **THEN** the `using-chrome-devtools` entry SHALL list `skills/using-chrome-devtools/references/live-session-safety.md`
- **AND** stdout SHALL contain a `Files (2)` group that lists `facet.json` and `README.md`

#### Scenario: Facet without supplementary files

- **WHEN** a facet declares no top-level `files` and no skill `files`
- **AND** a user runs `facet info` for that facet
- **THEN** stdout SHALL contain a `Files (1)` group that lists only `facet.json`

### Requirement: Info shows how to print each asset and file

For each skill, command, agent, and supplementary file in the `facet info` summary, the system SHALL print the exact `facet cat` command that prints its content. The printed command SHALL work when the user copies and runs it. MCP servers SHALL NOT have a `facet cat` command. When the summary is read from the local copy, a binary supplementary file SHALL show its size in place of a command. When the summary is read from the registry, files are not downloaded, so every declared file SHALL show a command and `facet cat` SHALL report a binary file when one is selected.

#### Scenario: Print hint for a skill

- **WHEN** a user runs `facet info mobbin`
- **THEN** the `using-mobbin` entry SHALL include `facet cat mobbin using-mobbin`

#### Scenario: Print hint for an agent that shares a name with a command

- **WHEN** a user runs `facet info cowsay`
- **AND** `cowsay` declares a command named `cowsay` and an agent named `cowsay`
- **THEN** the command entry SHALL include `facet cat cowsay commands/cowsay`
- **AND** the agent entry SHALL include `facet cat cowsay agents/cowsay`

#### Scenario: Print hint for a README

- **WHEN** a facet declares top-level `files` `["README.md"]`
- **AND** a user runs `facet info` for that facet
- **THEN** the `README.md` entry SHALL include `facet cat <name> README.md`

### Requirement: Info reads the installed copy when the facet is installed

When the current project declares the facet in `facets.json` and records it in `facets.lock`, `facet info` SHALL show the version recorded in `facets.lock` and SHALL mark the summary as installed. The summary SHALL describe the content of that installed version, not the latest published version. When the facet is not declared in the current project, or the command runs outside a project, `facet info` SHALL show the latest published version from the registry and SHALL print an `INSTALL:` line with the command that adds the facet to the project.

#### Scenario: Installed facet shows the locked version

- **WHEN** the project locks `cowsay` at `1.0.1`
- **AND** the registry's latest `cowsay` release is `1.0.2`
- **AND** a user runs `facet info cowsay`
- **THEN** the summary SHALL show version `1.0.1` and mark it as installed
- **AND** the asset list SHALL match the manifest of `cowsay` `1.0.1`

#### Scenario: Facet that is not installed is read from the registry

- **WHEN** the project does not declare `mobbin`
- **AND** a user runs `facet info mobbin`
- **THEN** the summary SHALL show the registry's latest `mobbin` version
- **AND** stdout SHALL contain a line that starts with `INSTALL:` and contains `facet add mobbin`

### Requirement: Info shows how the project materialized each asset

For an installed facet, `facet info` SHALL show each asset under the name the publisher gave it. When the project aliases an asset, its entry SHALL also show the effective name it is installed under. When the project omits an asset, its entry SHALL say that it is omitted. The `facet cat` hint for an aliased or omitted asset SHALL still use the publisher's name.

#### Scenario: Aliased command

- **WHEN** the project aliases the `cowsay` command of `cowsay` as `moo`
- **AND** a user runs `facet info cowsay`
- **THEN** the `cowsay` command entry SHALL show that it is installed as `moo`
- **AND** its hint SHALL be `facet cat cowsay commands/cowsay`

#### Scenario: Omitted skill

- **WHEN** the project omits the `cowsay-rules` skill of `cowsay`
- **AND** a user runs `facet info cowsay`
- **THEN** the `cowsay-rules` entry SHALL show that it is omitted
- **AND** its hint SHALL still be shown

### Requirement: Info points to the update check

For an installed facet, `facet info` SHALL print a line that starts with `Check for updates:` and gives the `facet outdated` command. `facet info` SHALL NOT itself report whether a newer release exists.

#### Scenario: Installed facet

- **WHEN** the project locks `mobbin` at `1.0.0`
- **AND** a user runs `facet info mobbin`
- **THEN** stdout SHALL contain a line that starts with `Check for updates:` and contains `facet outdated`
- **AND** stdout SHALL NOT contain `UPDATE AVAILABLE`

### Requirement: Info reports an unknown facet

When the facet is not installed in the project and the registry has no facet with that name that the user can see, `facet info` SHALL write an error to stderr that names the facet and suggests `facet search`. The process SHALL exit with code 1.

#### Scenario: Unknown facet name

- **WHEN** a user runs `facet info no-such-facet`
- **AND** the project does not declare `no-such-facet`
- **AND** the registry returns not found for `no-such-facet`
- **THEN** stderr SHALL contain `no-such-facet`
- **AND** stderr SHALL contain `facet search`
- **AND** the process SHALL exit with code 1

### Requirement: Cat command prints one asset or file

The system SHALL register a `cat` command that takes a facet name and a selector, and writes the full content of the selected skill, command, agent, or text supplementary file to stdout. For a skill, the content SHALL be the skill's `SKILL.md`. When stdout is not a terminal, stdout SHALL contain the content and nothing else, byte for byte. When stdout is a terminal, the content SHALL be rendered as the safe-terminal-output requirement describes. The command SHALL read from the same source `facet info` would use for that facet: the installed version when the project declares the facet, and the latest published version from the registry otherwise. The command SHALL NOT modify the project.

#### Scenario: Cat command is available in help

- **WHEN** a user runs the CLI with `--help`
- **THEN** the help output SHALL list the `cat` command with its description

#### Scenario: Print an installed skill

- **WHEN** the project locks `cowsay` at `1.0.2`
- **AND** a user runs `facet cat cowsay cowsay-rules` with stdout redirected to a file
- **THEN** the file SHALL be byte-identical to `skills/cowsay-rules/SKILL.md` of `cowsay` `1.0.2`
- **AND** the process SHALL exit with code 0

#### Scenario: Print an asset of a facet that is not installed

- **WHEN** the project does not declare `mobbin`
- **AND** a user runs `facet cat mobbin using-mobbin` with stdout redirected to a file
- **THEN** the file SHALL be byte-identical to `skills/using-mobbin/SKILL.md` of the registry's latest `mobbin` release

#### Scenario: Print a README

- **WHEN** a facet declares top-level `files` `["README.md"]`
- **AND** a user runs `facet cat <name> README.md` with stdout redirected to a file
- **THEN** the file SHALL be byte-identical to that facet's `README.md`

#### Scenario: Cat requires a facet and a selector

- **WHEN** a user runs `facet cat` with fewer than two arguments or more than two arguments
- **THEN** the system SHALL write an error to stderr that states the expected usage `facet cat <name> <asset-or-path>`
- **AND** the process SHALL exit with code 1

### Requirement: Cat selectors follow the facet's file layout

The selector argument to `facet cat` SHALL accept any of these forms:

- a bare asset name, such as `cowsay-rules`;
- an asset name prefixed by its type's folder (`skills/<name>`, `commands/<name>`, or `agents/<name>`);
- the exact path of a primary asset file (`skills/<name>/SKILL.md`, `commands/<name>.md`, or `agents/<name>.md`);
- the exact path of a declared supplementary file, relative to the facet root.

`facet.json` SHALL select the facet's manifest. A selector SHALL only ever resolve to `facet.json` or a path the facet's manifest declares. A selector that names any other path, including one containing `..`, an absolute path, or a path the manifest does not declare, SHALL be treated as matching nothing, and no file outside the facet SHALL be read. When the selected file is read from a directory on this machine, a file that is a symbolic link, sits under a symbolic-link directory, is a hard link, is not a regular file, or resolves outside the facet's directory SHALL be refused, both for printing and for `--path`.

A bare name that matches exactly one skill, command, or agent SHALL select that asset. Because skills and commands share one namespace and agents have their own, a bare name can match at most one agent and one skill or command. A bare name that matches both SHALL fail with an error on stderr that lists each match in its folder-prefixed form, and the process SHALL exit with code 1.

#### Scenario: Folder-prefixed name selects an agent that shares a name with a command

- **WHEN** `cowsay` declares a command named `cowsay` and an agent named `cowsay`
- **AND** a user runs `facet cat cowsay agents/cowsay`
- **THEN** stdout SHALL be the content of `agents/cowsay.md`

#### Scenario: Primary file path selects the same asset

- **WHEN** a user runs `facet cat cowsay commands/cowsay.md`
- **THEN** stdout SHALL be identical to the output of `facet cat cowsay commands/cowsay`

#### Scenario: Skill companion file by path

- **WHEN** skill `using-chrome-devtools` declares `files` `["references/live-session-safety.md"]`
- **AND** a user runs `facet cat chrome-devtools skills/using-chrome-devtools/references/live-session-safety.md` with stdout redirected to a file
- **THEN** the file SHALL be byte-identical to that companion file

#### Scenario: Selector cannot leave the facet

- **WHEN** a user runs `facet cat cowsay ../../.ssh/id_rsa`
- **THEN** stderr SHALL report that the selector matches nothing in `cowsay`
- **AND** stdout SHALL be empty
- **AND** the process SHALL exit with code 1

#### Scenario: Declared file that is a symbolic link

- **WHEN** a local facet declares `README.md` and its `README.md` is a symbolic link to a file outside the facet
- **AND** a user runs `facet cat <name> README.md`
- **THEN** stdout SHALL be empty and stderr SHALL say the file is refused
- **AND** the process SHALL exit with code 1

#### Scenario: Bare name that matches a command and an agent

- **WHEN** `cowsay` declares a command named `cowsay` and an agent named `cowsay`
- **AND** a user runs `facet cat cowsay cowsay`
- **THEN** stderr SHALL contain `commands/cowsay` and `agents/cowsay`
- **AND** stdout SHALL be empty
- **AND** the process SHALL exit with code 1

### Requirement: Cat reports what it cannot print

When the selector matches nothing in the facet, `facet cat` SHALL write an error to stderr that names the selector and lists what the facet has that `facet cat` can print. When the selector matches only an MCP server, the error SHALL say that MCP servers have no content to print and SHALL suggest `facet info`. When the selector matches a binary supplementary file, the error SHALL say that the file is binary and SHALL NOT write the file's bytes. In each case stdout SHALL be empty and the process SHALL exit with code 1.

#### Scenario: Selector not in the facet

- **WHEN** a user runs `facet cat mobbin no-such-asset`
- **THEN** stderr SHALL contain `no-such-asset`
- **AND** stderr SHALL list `using-mobbin` and `README.md`
- **AND** the process SHALL exit with code 1

#### Scenario: Selector is an MCP server

- **WHEN** a user runs `facet cat mobbin mobbin`
- **AND** `mobbin` declares an MCP server named `mobbin` and no skill, command, or agent named `mobbin`
- **THEN** stderr SHALL say that MCP servers have no content to print
- **AND** stderr SHALL contain `facet info mobbin`
- **AND** the process SHALL exit with code 1

#### Scenario: Selector is a binary file

- **WHEN** skill `review` declares `files` `["assets/logo.png"]`
- **AND** a user runs `facet cat <name> skills/review/assets/logo.png`
- **THEN** stderr SHALL say that `skills/review/assets/logo.png` is a binary file
- **AND** stdout SHALL be empty
- **AND** the process SHALL exit with code 1

### Requirement: Output shown in a terminal is safe to read

Facet content is written by its publisher and SHALL NOT be able to control the user's terminal. Every string `facet info` prints that comes from a facet (names, descriptions, paths, server commands, arguments, and URLs) SHALL have control characters made visible rather than written raw, whether or not stdout is a terminal. `facet cat` SHALL do the same when stdout is a terminal. Characters made visible SHALL include:

- C0 control characters other than line feed and tab, shown in caret notation (for example ESC as `^[`). A carriage return that ends a CRLF line ending SHALL be shown as a normal line break.
- DEL, shown as `^?`.
- Every other character in the Unicode control (`Cc`) or format (`Cf`) category, line and paragraph separators (`Zl`, `Zp`), and every default-ignorable code point, shown as `<U+XXXX>`. This includes C1 controls, bidirectional controls, zero-width characters, Unicode tag characters, and variation selectors. The text and emoji presentation selectors U+FE0E and U+FE0F SHALL be shown as they are.

Publisher text SHALL NOT be able to add lines of its own to the `facet info` summary. Line breaks and other runs of whitespace in the author and in descriptions SHALL be shown as one space. The facet's description SHALL be indented, and wrapped lines of an asset description SHALL be indented further than that asset's `facet cat` hint. An MCP server URL SHALL be shown in the form its client resolves, with an internationalized host name in its punycode (`xn--`) form. Each part of a `stdio` server's command and arguments SHALL be quoted as the paste-safety requirement describes, with a line feed or tab shown in caret notation.

#### Scenario: Look-alike host in a server URL

- **WHEN** an HTTP server's URL is `https://аnthropic.com/mcp`, with a Cyrillic `а`
- **AND** a user runs `facet info` for that facet
- **THEN** stdout SHALL show the host as `xn--nthropic-06g.com`

When `facet cat` makes at least one character visible, it SHALL write a note to stderr that states how many characters were made visible and that redirecting the output gives the raw bytes.

#### Scenario: Escape sequence in a description

- **WHEN** a facet's skill description contains the bytes `ESC [ 8 m`
- **AND** a user runs `facet info` for that facet
- **THEN** stdout SHALL contain `^[[8m`
- **AND** stdout SHALL NOT contain the ESC byte

#### Scenario: Escape sequence in a file printed to a terminal

- **WHEN** a skill's `SKILL.md` contains the ESC byte
- **AND** a user runs `facet cat` for that skill with stdout attached to a terminal
- **THEN** stdout SHALL show the ESC byte as `^[` and SHALL NOT contain the ESC byte
- **AND** stderr SHALL contain a note that one character was made visible

#### Scenario: Escape sequence in a file that is redirected

- **WHEN** a skill's `SKILL.md` contains the ESC byte
- **AND** a user runs `facet cat` for that skill with stdout redirected to a file
- **THEN** the file SHALL be byte-identical to `SKILL.md`, including the ESC byte

#### Scenario: Unicode tag characters in a description

- **WHEN** a skill description contains Unicode tag characters (U+E0000 to U+E007F)
- **AND** a user runs `facet info` for that facet
- **THEN** stdout SHALL show each tag character as `<U+XXXXX>`

#### Scenario: Bidirectional override in a file

- **WHEN** a command file contains U+202E RIGHT-TO-LEFT OVERRIDE
- **AND** a user runs `facet cat` for that command with stdout attached to a terminal
- **THEN** stdout SHALL contain `<U+202E>` in place of that character

### Requirement: Printed commands are safe to paste

Every command that `facet info` or a `facet` error prints for the user to copy SHALL quote each argument that comes from a facet so that a POSIX shell passes it as one literal argument. Running a pasted hint SHALL NOT execute any part of a facet-supplied name or path.

#### Scenario: File path with shell characters

- **WHEN** a facet declares top-level `files` `["notes;touch pwned.md"]`
- **AND** a user runs `facet info` for that facet
- **THEN** the hint for that file SHALL be `facet cat <name> 'notes;touch pwned.md'`

### Requirement: Cat can print the location of an installed file

`facet cat` SHALL accept a `--path` flag. With `--path`, the command SHALL print the absolute path of the selected file in the verified local copy of the installed facet, followed by a newline, instead of the file's content. It SHALL NOT open, execute, or read out the file. When stdout is a terminal, the path SHALL be quoted as the paste-safety requirement describes. When the facet is not installed in the project, or no verified local copy of the installed version exists, the command SHALL fail with an error that names the fix (`facet add <name>` or `facet install`), and the process SHALL exit with code 1.

#### Scenario: Path of an installed skill

- **WHEN** the project locks `cowsay` at `1.0.2` and its local copy is verified
- **AND** a user runs `facet cat --path cowsay cowsay-rules` with stdout redirected
- **THEN** stdout SHALL be the absolute path of `skills/cowsay-rules/SKILL.md` in the local copy of `cowsay` `1.0.2`, followed by a newline
- **AND** the file at that path SHALL be byte-identical to the published `SKILL.md`

#### Scenario: Path of a facet that is not installed

- **WHEN** the project does not declare `mobbin`
- **AND** a user runs `facet cat --path mobbin using-mobbin`
- **THEN** stderr SHALL contain `facet add mobbin`
- **AND** stdout SHALL be empty
- **AND** the process SHALL exit with code 1

### Requirement: Info links to the facet's page on the website

The `facet info` summary SHALL end with a line that starts with `WEB:` and gives the address of the facet's page on the Agent Facets website. The address SHALL be built from the website's origin and the facet's name, using `/facets/<name>` for an unscoped facet and `/facets/@<scope>/<name>` for a scoped facet. The website origin SHALL default to `https://agentfacets.io`, and the user SHALL be able to override it with the `FACET_WEB_URL` environment variable. When the user has pointed the CLI at a registry other than the default and has not set `FACET_WEB_URL`, the line SHALL NOT appear. The CLI SHALL NOT open the address.

#### Scenario: Link for an unscoped facet

- **WHEN** a user runs `facet info mobbin` with the default registry and no `FACET_WEB_URL`
- **THEN** stdout SHALL contain a line `WEB: https://agentfacets.io/facets/mobbin`

#### Scenario: Link for a scoped facet

- **WHEN** a user runs `facet info @agentfacets/betterstack` with the default registry
- **THEN** stdout SHALL contain `https://agentfacets.io/facets/@agentfacets/betterstack`

#### Scenario: Custom registry without a website override

- **WHEN** `FACET_REGISTRY_URL` points at a registry other than the default
- **AND** `FACET_WEB_URL` is not set
- **AND** a user runs `facet info mobbin`
- **THEN** stdout SHALL NOT contain `WEB:`

#### Scenario: Website override

- **WHEN** `FACET_WEB_URL` is `https://dev.agentfacets.io`
- **AND** a user runs `facet info mobbin`
- **THEN** stdout SHALL contain `WEB: https://dev.agentfacets.io/facets/mobbin`

### Requirement: Info and cat read an installed facet without the network

When the project declares and locks a facet and its verified local copy is present, `facet info` and `facet cat` SHALL NOT contact the registry.

#### Scenario: Installed facet with the registry unreachable

- **WHEN** the project locks `mobbin` at `1.0.0` and its verified local copy is present
- **AND** the registry cannot be reached
- **AND** a user runs `facet info mobbin`
- **THEN** no request SHALL be sent to the registry
- **AND** stdout SHALL contain the full summary of `mobbin` `1.0.0`
- **AND** stderr SHALL be empty
- **AND** the process SHALL exit with code 0

### Requirement: Info shows the author and the verified publisher separately

The `facet info` header SHALL show the facet's free-text `author` from its manifest when one is set, as `by "<author>"`, with any backslash or double quote in it escaped with a backslash. When the summary is read from the registry, the header SHALL also show the verified Agent Facets identity that published the version shown, as `published by @<username>`, or `@<org>, published by @<username>` for an organization-owned facet. The author SHALL never appear in the position or the `@` form of the verified identity. A summary read from the local copy SHALL show only the author.

#### Scenario: Facet read from the registry

- **WHEN** the project does not declare `mobbin`
- **AND** the registry reports `"author": "Julian Smith"`, publisher `julian`, and owner user `julian` for the latest version
- **AND** a user runs `facet info mobbin`
- **THEN** the header SHALL contain `by "Julian Smith"`
- **AND** the header SHALL contain `published by @julian`

#### Scenario: Organization-owned facet

- **WHEN** the registry reports owner organization `acme` and publisher `julian` for the version shown
- **AND** a user runs `facet info` for that facet
- **THEN** the header SHALL contain `@acme, published by @julian`

#### Scenario: Self-declared author that looks like an identity

- **WHEN** a facet declares `"author": "@anthropic"` and the registry reports publisher `mallory`
- **AND** a user runs `facet info` for that facet
- **THEN** the header SHALL contain `by "@anthropic"`
- **AND** the header SHALL contain `published by @mallory`

#### Scenario: Author text that imitates a verified publisher

- **WHEN** a facet declares `"author": "Mallory\" · published by @anthropic"`
- **AND** a user runs `facet info` for it
- **THEN** the header SHALL contain `by "Mallory\" · published by @anthropic"`

#### Scenario: Installed facet shows only the author

- **WHEN** an installed facet declares `"author": "Julian Smith"` and its verified local copy is present
- **AND** a user runs `facet info` for it
- **THEN** the header SHALL contain `by "Julian Smith"`
- **AND** the header SHALL NOT contain `published by`

### Requirement: Info states where the summary was read from

Directly under the facet's name, `facet info` SHALL print a line that says whether the facet is installed and where the summary was read from: the local copy, a local facet's source directory, or the registry. When an installed facet's summary was read from the registry because its local copy is missing or damaged, the line SHALL say so and SHALL give the `facet install` command that repairs it.

#### Scenario: Installed facet read from the local copy

- **WHEN** the project locks `cowsay` and its verified local copy is present
- **AND** a user runs `facet info cowsay`
- **THEN** the second line of stdout SHALL be `Installed · read from your local copy`

#### Scenario: Facet that is not installed

- **WHEN** the project does not declare `mobbin`
- **AND** a user runs `facet info mobbin`
- **THEN** the second line of stdout SHALL say that `mobbin` is not installed and is read from the registry's latest published version

#### Scenario: Installed facet whose local copy is damaged

- **WHEN** the project locks `cowsay` and its local copy fails its integrity check
- **AND** the registry has the locked version
- **AND** a user runs `facet info cowsay`
- **THEN** stdout SHALL say that `cowsay` is installed and was read from the registry because the local copy is missing or damaged
- **AND** stdout SHALL contain `facet install`
