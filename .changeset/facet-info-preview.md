---
'agent-facets': minor
---

`facet info` and `facet cat` now work for facets the project has not installed, reading the registry's latest version so you can see what a facet contains before adding it. `facet info` downloads no files, and shows the account that published the version, verified by the registry, apart from the facet's self-declared author. An installed registry facet whose local copy is missing or fails its integrity check is read from the registry at the locked version, checked against `facets.lock`.
