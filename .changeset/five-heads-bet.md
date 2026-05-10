---
"@agent-facets/protocol": minor
"agent-facets": minor
---

Generate the registry client from the registry's published OpenAPI spec.

The registry server (`facet-cafe`) auto-generates an OpenAPI specification from its actual route handlers; the CLI now consumes that spec as its source of truth. A vendored snapshot of the OpenAPI lives in `@agent-facets/engine`, and TypeScript types are generated from it via `openapi-typescript`. Path strings, params, and response shapes are type-checked end-to-end at every call site through `openapi-fetch`. A registry response field that is renamed, removed, or changes shape now surfaces as a build-time error in a CLI pull request — not a runtime "unexpected response" in front of a user.

Run `bun run --cwd packages/engine codegen:registry` to refresh the snapshot. A CI job warns when the snapshot is more than 7 days behind the live registry (configurable via `STALENESS_THRESHOLD_DAYS`).

User-visible: `facet search` results now include a one-line asset-count summary per result (e.g., `1 agent, 2 commands, 1 server`) — surfacing data the registry has been returning all along.

Behavior corrections during the migration off `registryFetch`:

- POST requests no longer auto-retry on network error (could re-issue an upload that was already received).
- The 10s deadline is now per-call instead of per-attempt — a fully-failing call no longer blocks for up to 16s.
- Caller-supplied abort signals are composed with the deadline via `AbortSignal.any` instead of being silently overwritten.
- Retries honor the server's `Retry-After` header, capped at 5s.
- Non-network errors now surface as `UNEXPECTED_ERROR` instead of being mislabeled as network failures.
- Retry-exhausted errors carry an `attempts` count so user-facing messages can show retry history.
