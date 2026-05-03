## ADDED Requirements

### Requirement: YAML front matter in asset files is encoded as a delimited block

A facet asset file (skill, agent, or command) MAY begin with a YAML front-matter block. The block SHALL be delimited by a line consisting of exactly three hyphens (`---`) at the start of the file, a YAML document, and a closing line consisting of exactly three hyphens (`---`). The body of the asset SHALL follow the closing delimiter. A facet-compatible system that produces or consumes asset files SHALL honor this encoding.

#### Scenario: An asset file with front matter is parsed correctly

- **WHEN** a system reads an asset file beginning with `---\n<yaml>\n---\n<body>`
- **THEN** the system SHALL extract the YAML document as the asset's front-matter attributes
- **AND** the system SHALL extract the content following the closing delimiter as the asset's body

#### Scenario: An asset file without front matter is treated as body-only

- **WHEN** a system reads an asset file that does not begin with `---`
- **THEN** the system SHALL treat the entire file content as the asset's body
- **AND** the system SHALL treat the asset's front-matter attributes as empty

#### Scenario: Empty front matter is permitted

- **WHEN** a system reads an asset file beginning with `---\n---\n<body>`
- **THEN** the system SHALL treat the asset's front-matter attributes as empty
- **AND** the system SHALL extract the content after the closing delimiter as the body

### Requirement: Malformed front-matter YAML is tolerated as body-only content

A facet-compatible system SHALL NOT fail on a YAML parse error inside an asset file's front-matter block. If the YAML is malformed, the system SHALL treat the file as if it had no front matter — the entire content (including the `---` delimiters) SHALL be treated as the asset's body, and the front-matter attributes SHALL be empty.

#### Scenario: Malformed YAML in front matter is preserved as body content

- **WHEN** a system reads an asset file whose front-matter block contains invalid YAML
- **THEN** the system SHALL NOT raise a parse error
- **AND** the system SHALL treat the entire file content as the asset's body
- **AND** the system SHALL treat the front-matter attributes as empty

### Requirement: Front-matter attributes from the asset file are merged with manifest-declared attributes at install time

When an asset is installed, a facet-compatible system SHALL merge the front-matter attributes declared in the asset file with the attributes declared by the facet manifest for that asset. The system SHALL preserve attributes the author placed in the asset file unless they conflict with attributes computed from the manifest's identity (`name`, `description`) or per-adapter extras. In the conflict case, the manifest-derived attributes SHALL win — a facet author cannot override the asset's identity via front matter.

#### Scenario: Author-only attributes are preserved

- **WHEN** an asset file has front-matter attributes that do not appear in the manifest
- **AND** the asset is installed
- **THEN** the installed asset's front matter SHALL include the author-declared attributes

#### Scenario: Manifest-declared identity wins over front-matter conflict

- **WHEN** an asset file's front matter declares a `name` field that differs from the manifest's declared name for that asset
- **AND** the asset is installed
- **THEN** the installed asset's `name` SHALL be the manifest-declared value
- **AND** the author's front-matter `name` SHALL be discarded

#### Scenario: Per-adapter extras win over front-matter conflict

- **WHEN** the manifest declares per-adapter extra attributes for an asset
- **AND** the asset file's front matter declares attributes with the same keys
- **AND** the asset is installed
- **THEN** the installed asset's attributes SHALL be the manifest's per-adapter extras
- **AND** the author's conflicting front-matter attributes SHALL be discarded
