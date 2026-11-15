---
'agent-facets': patch
---

Arguments after `--` are now always treated as positional, so a file whose name starts with `-` can be selected (`facet cat <name> -- --help`). Loading a facet's `facet.json` now refuses anything that is not a regular file, such as a named pipe, instead of waiting on it.

Error messages from every command now show terminal control characters as visible escapes. Before, a crafted `facets.json` could send escape sequences to the terminal through the error that `facet list`, `facet outdated`, and `facet update` print for it.
