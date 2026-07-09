---
"@agent-facets/adapter-claude-code": patch
"@agent-facets/adapter-opencode": patch
"@agent-facets/adapter-codex": patch
"@agent-facets/protocol": patch
"@agent-facets/adapter": patch
"@agent-facets/brand": patch
"agent-facets": patch
---

Widen the `typescript` peerDependency range to `^5 || ^6 || ^7` so the
package installs cleanly for consumers on TypeScript 7. Consumers on
TypeScript 5 or 6 are unaffected.
