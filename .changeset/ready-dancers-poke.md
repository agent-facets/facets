---
"agent-facets": minor
---

**`facet adapter install` is now `facet adapter add`.** The verb matches the split it mirrors at the top level: `add` takes a specifier and installs what you name, `install` takes none. Every reinstall command the CLI prints — next to a failing entry in `facet adapter list`, and in the compatibility diagnostics that stop `facet build`, `facet add`, `facet remove`, and `facet install` — now names `facet adapter add`.

The old spelling keeps working as a deprecated alias. It runs the same code, produces the same stdout, and exits with the same code; the only difference is one deprecation notice on stderr naming the new command. No existing script breaks, and nothing parsing stdout sees a change.
