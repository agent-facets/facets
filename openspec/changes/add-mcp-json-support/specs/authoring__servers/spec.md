## REMOVED Requirements

### Requirement: Valid server manifests are accepted

**Reason**: The standalone server project and `server.json` contract was speculative, depended on retired ADR guidance, and had no publishing, resolution, or runtime implementation.

**Migration**: Authors SHALL declare concrete project-scoped MCP server connections inside a facet's `servers` map. There is no standalone server-manifest replacement in this release.

### Requirement: Invalid server manifests are rejected with actionable errors

**Reason**: Standalone server manifests are no longer a supported artifact, so a separate validation contract would describe a format the system does not consume.

**Migration**: Authors SHALL use the facet-manifest validation errors for concrete declarations in `facet.json`.

### Requirement: Unrecognized fields are tolerated

**Reason**: The standalone server-manifest extension contract is removed with the artifact. Concrete MCP declaration objects intentionally reject unrecognized members because they affect execution and network behavior.

**Migration**: Authors SHALL place only fields supported by the selected concrete MCP declaration type in `facet.json`.

### Requirement: Server manifests are loaded from disk

**Reason**: The system no longer recognizes a standalone server manifest or server-project directory.

**Migration**: Authors SHALL load and validate MCP declarations as part of the containing facet manifest.
