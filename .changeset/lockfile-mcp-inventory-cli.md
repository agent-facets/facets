---
"agent-facets": minor
---

**Breaking:** `facet install`, `add`, `update`, and `remove` now write lockfile `0.4`, which records every facet's MCP servers by name, fingerprint, and alias or omission. Earlier CLIs cannot read it. Upgrade every CLI that shares a project, then run one plain `facet install` to migrate and commit `facets.lock`.

`facet install --frozen-lockfile` now checks server intent before downloading anything. With a `0.4` lockfile, a server collision, a stale server override, or a server alias or omission that differs from the lockfile fails immediately. With a `0.2` or `0.3` lockfile, any server alias or omission is refused with a request to migrate. The message names the format that can record the choice (`0.3` for a text-asset choice under `0.2`, `0.4` for a server choice), while a normal install always writes `0.4`. Older lockfiles without server overrides still reproduce unchanged.

A facet whose recorded server names or fingerprints disagree with its verified content now fails with `RECONCILE_SERVER_IDENTITY` or `RECONCILE_SERVER_FINGERPRINT`. Restore the lockfile from a trusted revision; re-running does not regenerate it.

The first `facet remove` that keeps facets under a `0.2` or `0.3` lockfile resolves and verifies them to write `0.4`, which may need the network or MCP approval. A failed migration changes nothing and reports the underlying cause. Removing every facet needs no content.

MCP approval, `--accept-mcp`, takeover prompts, and deletion authority are unchanged and stay machine-local; a lockfile never grants them. The Adapter SDK API is unchanged.
