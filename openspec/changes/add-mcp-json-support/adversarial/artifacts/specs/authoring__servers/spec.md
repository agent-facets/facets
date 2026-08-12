## REMOVED Requirements

### Requirement: Valid server manifests are accepted

**Reason**: The standalone server-authoring contract is retired. No implementation ever resolved a separately authored server project, and the server manifest described a registry/runtime model that is explicitly out of scope. MCP servers are now declared as concrete connection declarations inside a facet's own `facet.json`.

**Migration**: Author server connection information directly in `facet.json` under `servers` as a concrete stdio or Streamable HTTP declaration. There is no separate server project or server manifest to author. If standalone server publishing and resolution are wanted later, they must be deliberately designed as a new capability.

### Requirement: Invalid server manifests are rejected with actionable errors

**Reason**: The server manifest no longer exists; there is nothing to validate. Validation of MCP declarations now happens on `facet.json` under the facet manifest schema.

**Migration**: Malformed server declarations in `facet.json` are rejected by facet manifest validation with errors identifying the server name and field.

### Requirement: Unrecognized fields are tolerated

**Reason**: This tolerance rule governed the retired server manifest. Concrete server declarations inside `facet.json` intentionally invert it: unknown declaration members are rejected because they can change execution behavior.

**Migration**: None. Unknown-field tolerance for facet manifests as a whole is unchanged; only server declaration objects are closed.

### Requirement: Server manifests are loaded from disk

**Reason**: With no server manifest file, there is no server-manifest loading contract.

**Migration**: Server declarations are loaded as part of ordinary facet manifest loading and validation.
