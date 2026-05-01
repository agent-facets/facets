---
"@agent-facets/adapter": patch
"@agent-facets/adapter-claude-code": patch
"@agent-facets/adapter-codex": patch
"@agent-facets/adapter-opencode": patch
"@agent-facets/core": minor
"agent-facets": minor
---

`facet add <source>` now resolves, writes, and installs in one step instead of leaving the user to run `facet install` separately. Multiple sources per invocation are supported. `facets.json` rolls back byte-for-byte on failure.

The adapter picker auto-launches when `add` runs against a project with no connected adapters in a TTY. Non-TTY exits with a clear "no adapters installed" error.

Source grammar tightened for closed alpha: `git+` prefixes hard-rejected, `^` / `~` / `1.x` ranges hard-rejected with a fix pointing at the supported `*` wildcards (`1.*`, `1.2.*`), and bare registry names route to a registry stub that errors clearly until the real registry ships.

The install pipeline (sources, resolvers, lockfile I/O, materialization, integrity, cache, registry stub) moved from the CLI into `@agent-facets/core`. The CLI is now display-only on top.

`@agent-facets/adapter` fixes a blank-line asymmetry in `assembleAssetContent` that made `materialize`'s skip-if-identical check see phantom drift on every re-install. First-party adapter packages republish at the patch level so the bundled fix reaches existing installs.
