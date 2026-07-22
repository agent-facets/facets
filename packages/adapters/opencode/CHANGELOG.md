# @agent-facets/adapter-opencode

## 0.9.0

### Minor Changes

- [#447](https://github.com/agent-facets/facets/pull/447) [`d6581c6`](https://github.com/agent-facets/facets/commit/d6581c6046e12ca2c785ac9fe686a1967cd40205) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Declare adapter API `0.0` across the adapter toolchain. `defineAdapter()` now stamps a readonly `apiVersion` (`"0.0"`) onto every runtime adapter — the definition type excludes it, so authors cannot supply a conflicting value — and the SDK exports the canonical constants (`ADAPTER_API_VERSION`, `ADAPTER_API_VERSION_PACKAGE_FIELD`) from the new dependency-free `@agent-facets/adapter/api-version` subpath. First-party adapter packages now publish `"facetAdapterApiVersion": "0.0"` in their manifests (injected at pack time from the SDK constants) so compatibility-aware CLIs can select a compatible release from npm metadata before downloading it. The positional adapter method contract itself is unchanged: these releases remain fully consumable by already-published CLIs.

## 0.8.0

### Minor Changes

- [#424](https://github.com/agent-facets/facets/pull/424) [`12e7ff6`](https://github.com/agent-facets/facets/commit/12e7ff601a9e88ff42f9c5d45bce8a18263797b1) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Prune empty directories when removing assets and nothing is left in the directory

## 0.7.1

### Patch Changes

- [#404](https://github.com/agent-facets/facets/pull/404) [`ba747bd`](https://github.com/agent-facets/facets/commit/ba747bdcf1884ff82e397b21e9897a32eac8055c) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Widen the `typescript` peerDependency range to `^5 || ^6 || ^7` so the
  package installs cleanly for consumers on TypeScript 7. Consumers on
  TypeScript 5 or 6 are unaffected.

## 0.7.0

### Minor Changes

- [#393](https://github.com/agent-facets/facets/pull/393) [`b0c0be6`](https://github.com/agent-facets/facets/commit/b0c0be6a44bbfe4c9199684180d2ba3bd66f7949) Thanks [@eXamadeus](https://github.com/eXamadeus)! - BREAKING CHANGE: Rebrand from Facet.cafe to agentfacets.io for the registry

## 0.6.1

### Patch Changes

- [#382](https://github.com/agent-facets/facets/pull/382) [`79b1d50`](https://github.com/agent-facets/facets/commit/79b1d50b9ba1721081900e0f775cd3fed8dc2767) Thanks [@dependabot](https://github.com/apps/dependabot)! - Updated tsdown from 0.22.0 to 0.22.3

## 0.6.0

### Minor Changes

- [#348](https://github.com/agent-facets/facets/pull/348) [`c4ac343`](https://github.com/agent-facets/facets/commit/c4ac343ebbc4a2c77dda8e56115f86fe368d77bc) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Expand metadata support to include model, permission, agent, and subtask fields

## 0.5.0

### Minor Changes

- [#325](https://github.com/agent-facets/facets/pull/325) [`ef26047`](https://github.com/agent-facets/facets/commit/ef26047602d8b546dfcb19c3fcef9c4ce485beaf) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Added verbose logging and updated adapters to return asset install paths (for logging purposes)

### Patch Changes

- [#328](https://github.com/agent-facets/facets/pull/328) [`dc4bbd0`](https://github.com/agent-facets/facets/commit/dc4bbd080474c2bb45f09ab2f013bd5904afc209) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Upgraded bun from 1.3.13 to 1.3.14

## 0.4.6

### Patch Changes

- [#299](https://github.com/agent-facets/facets/pull/299) [`982eafd`](https://github.com/agent-facets/facets/commit/982eafda525fa318ea8c41582c7541f552f34962) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Minor CI caching improvement

## 0.4.5

### Patch Changes

- [#242](https://github.com/agent-facets/facets/pull/242) [`03e9604`](https://github.com/agent-facets/facets/commit/03e9604df207627bf1d5fc5cd2f212bc909239c5) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Bump it all, upgraded CI config need to verify release machinery

## 0.4.4

### Patch Changes

- [#221](https://github.com/agent-facets/facets/pull/221) [`b2f92a4`](https://github.com/agent-facets/facets/commit/b2f92a45198ec5495e9f8dae414881bffa1cd8a7) Thanks [@eXamadeus](https://github.com/eXamadeus)! - `facet add <source>` now resolves, writes, and installs in one step instead of leaving the user to run `facet install` separately. Multiple sources per invocation are supported. `facets.json` rolls back byte-for-byte on failure.
  The adapter picker auto-launches when `add` runs against a project with no connected adapters in a TTY. Non-TTY exits with a clear "no adapters installed" error.
  Source grammar tightened for closed alpha: `git+` prefixes hard-rejected, `^` / `~` / `1.x` ranges hard-rejected with a fix pointing at the supported `*` wildcards (`1.*`, `1.2.*`), and bare registry names route to a registry stub that errors clearly until the real registry ships.
  The install pipeline (sources, resolvers, lockfile I/O, materialization, integrity, cache, registry stub) moved from the CLI into `@agent-facets/core`. The CLI is now display-only on top.
  `@agent-facets/adapter` fixes a blank-line asymmetry in `assembleAssetContent` that made `materialize`'s skip-if-identical check see phantom drift on every re-install. First-party adapter packages republish at the patch level so the bundled fix reaches existing installs.

## 0.4.3

### Patch Changes

- [#211](https://github.com/agent-facets/facets/pull/211) [`66b2fa3`](https://github.com/agent-facets/facets/commit/66b2fa3f70b663ba28e64e4fbc16e0eb60f4498a) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Bump eveything to refresh publish pipelines

## 0.4.2

### Patch Changes

- [#206](https://github.com/agent-facets/facets/pull/206) [`d42ef55`](https://github.com/agent-facets/facets/commit/d42ef55cf5ab31f34fcdbac5ce4548b918a1bde4) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Use pack-then-publish mechanism to ensure no drift between packument and published tarballs

## 0.4.1

### Patch Changes

- [#183](https://github.com/agent-facets/facets/pull/183) [`c9a1a4d`](https://github.com/agent-facets/facets/commit/c9a1a4dfe7e28437d6b523c6fa83ff17ac9b9f94) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Serial deploys via CI to ensure tag and release ordering

## 0.4.0

### Minor Changes

- [#168](https://github.com/agent-facets/facets/pull/168) [`8a697b5`](https://github.com/agent-facets/facets/commit/8a697b597842bcb4d3207ca73d429f4dff2be7b4) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Clean up publish failures

## 0.3.0

### Minor Changes

- [#150](https://github.com/agent-facets/facets/pull/150) [`70ec72b`](https://github.com/agent-facets/facets/commit/70ec72b00cb9f679faa516dc973297d3d99b769b) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Adapter SDK + first-party adapters gain real install support.

## 0.2.3

### Patch Changes

- f673986 Thanks @eXamadeus! - Correct CircleCI deployment keys

## 0.2.2

### Patch Changes

- [#145](https://github.com/agent-facets/facets/pull/145) [`a09846b`](https://github.com/agent-facets/facets/commit/a09846bce2b449287261ed4511ff0c3ad1599d6e) Thanks [@eXamadeus](https://github.com/eXamadeus)! - CircleCI

## 0.2.1

### Patch Changes

- [#142](https://github.com/agent-facets/facets/pull/142) [`2c74835`](https://github.com/agent-facets/facets/commit/2c74835443d78f16e0c4cc8effc8d7f0b01e593f) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Fixed bundling of adapters
- [#144](https://github.com/agent-facets/facets/pull/144) [`5c235e0`](https://github.com/agent-facets/facets/commit/5c235e08126e7dd6640c921625189f6fca1b4d5d) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Bump em all. Test release pipeline

## 0.2.0

### Minor Changes

- [#128](https://github.com/agent-facets/facets/pull/128) [`a350666`](https://github.com/agent-facets/facets/commit/a3506668311707d96f46d912177abd868a1e88ce) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Added in an SDK for adapting the facet CLI to various systems/tools

### Patch Changes

- [#129](https://github.com/agent-facets/facets/pull/129) [`f8a5a7b`](https://github.com/agent-facets/facets/commit/f8a5a7b78f96d8269042a05caf360ee95ed76cb4) Thanks [@eXamadeus](https://github.com/eXamadeus)! - Publish all packages touched

#### Updated Dependencies

- @agent-facets/adapter@0.2.0
