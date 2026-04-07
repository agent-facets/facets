---
"agent-facets": patch
---

Fix release pipeline:

- support keyless promotion inspired by Nuxt's OIDC JWT exchange
- use a matrix release workflow (because the key exchange is per-package and the builds are resource intense)
- use custom notifications for failures to the dev team's Slack
