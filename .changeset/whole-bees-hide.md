---
"agent-facets": minor
---

Migrate the CLI to the registry's Bearer-token `/v0/facets/*` contract.

**Breaking:** the `FACET_REGISTRY_API_KEY` environment variable is removed with no fallback. Authenticate with a personal access token instead — set `FACET_TOKEN`, or run the new `facet login` to verify and save one to `~/.facet/credentials`.

Also adds `facet whoami` and `facet logout`; renders registry errors using the registry's own message and suggested fix; lets `facet publish` take an optional directory argument; and treats a queued-for-review publish as success.
