---
"agent-facets": patch
---

Validate `adapters` blocks on command assets during `facet build`.

Command descriptors have always been allowed to declare an `adapters` block (symmetric with skills and agents), but the build pipeline only ran adapter-metadata validation over skills and agents — command adapter config was silently accepted without being checked. `facet build` now validates command `adapters` blocks the same way: an installed adapter that rejects the metadata fails the build with a `commands.<name>.adapters.<adapter>.<field>` error path, and an unknown adapter on a command produces the usual "metadata will not be validated" warning.
