---
"agent-facets": minor
---

Add browser sign-in with `facet login --browser` and manual device verification with `facet login --no-browser` on macOS and Linux. Registry commands renew and verify browser sessions before use; personal access tokens keep priority over browser credentials.

Use `facet login --token` in a terminal or `FACET_TOKEN` for CI and Windows. Browser credentials are stored separately from personal access tokens and are bound to their registry.

`facet logout` now confirms remote browser session revocation before local cleanup. Use `facet logout --local` for local cleanup with remote revocation unverified. Personal access token logout remains local removal, and environment tokens must be unset separately.
