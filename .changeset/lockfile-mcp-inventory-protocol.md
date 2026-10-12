---
"@agent-facets/protocol": minor
---

**Breaking:** lockfile `0.4` records each facet's MCP servers, and the current writer types now describe `0.4` only. Every `0.4` facet entry requires a `servers` array, sorted by authored name, holding each server's `name`, canonical `fingerprint`, and `materialization` disposition. An empty array means the facet declares no servers. Omitted servers stay listed. `0.2` and `0.3` remain readable through their exact schemas and the version-tagged `SupportedLockfile` union. Code that constructs `CurrentLockfile` values must now supply `servers` for each facet.

`0.4` fingerprints are bound to the existing `facets:mcp-server:v1` encoding, now exported as `MCP_SERVER_FINGERPRINT_ENCODING` and, for the lockfile binding, `LOCKFILE_0_4_SERVER_FINGERPRINT_ENCODING`. Fingerprint results are unchanged.

Add `deriveLockedMcpInventory`, which derives the selected server set and every contributing facet's provenance from a parsed lockfile without files, network, or archives. It returns `inventory-unavailable` for `0.2` and `0.3`, and a `collision` result with no partial selection when recorded claims conflict. Add `planLockedServerInventory` for planning manifest intent over fingerprint-only inventories. To verify exported servers, fingerprint the declarations you exported and compare complete name and fingerprint sets; see the lockfile inventory reference.

Agreement with a lockfile does not prove the lockfile is authentic or that anything was installed or approved. Fingerprints hash literal declaration values, including environment values, so keep secrets out of declarations.
