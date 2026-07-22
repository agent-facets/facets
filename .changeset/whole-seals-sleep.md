---
"@agent-facets/adapter-claude-code": minor
"@agent-facets/adapter-opencode": minor
"@agent-facets/adapter-codex": minor
"@agent-facets/adapter": minor
---

Declare adapter API `0.0` across the adapter toolchain. `defineAdapter()` now stamps a readonly `apiVersion` (`"0.0"`) onto every runtime adapter — the definition type excludes it, so authors cannot supply a conflicting value — and the SDK exports the canonical constants (`ADAPTER_API_VERSION`, `ADAPTER_API_VERSION_PACKAGE_FIELD`) from the new dependency-free `@agent-facets/adapter/api-version` subpath. First-party adapter packages now publish `"facetAdapterApiVersion": "0.0"` in their manifests (injected at pack time from the SDK constants) so compatibility-aware CLIs can select a compatible release from npm metadata before downloading it. The positional adapter method contract itself is unchanged: these releases remain fully consumable by already-published CLIs.
