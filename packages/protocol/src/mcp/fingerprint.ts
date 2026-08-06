import { createHash } from 'node:crypto'
import { compareCodeUnits } from '../ordering.ts'
import type { McpServerDeclaration } from '../schemas/mcp-server.ts'

/**
 * Canonical semantic fingerprint for a portable MCP server declaration.
 *
 * The fingerprint answers exactly one question: "is this the same connection
 * or launch behavior the user already approved?" It is the value the
 * machine-local receipt stores in place of the declaration itself, so a
 * receipt can prove prior approval without ever recording a command, its
 * arguments, a URL, or an environment name or value.
 *
 * Two independent consumers must agree on it, so the encoding — not merely
 * the digest — is part of the contract:
 *
 *   - **Tagged.** The transport is encoded explicitly, so a stdio and an HTTP
 *     declaration can never collide by coincidence of their other fields.
 *   - **Positional, not object-keyed.** The preimage is a JSON array, so it
 *     cannot inherit JSON object member order from whatever produced the
 *     declaration. Two manifests that parse to the same declaration produce
 *     the same bytes regardless of how they were written.
 *   - **Argument order preserved.** Reordering arguments changes behavior, so
 *     it changes the fingerprint.
 *   - **Environment keys sorted** by the shared code-unit comparator.
 *     Environment assignment order does not change behavior, so it must not
 *     change the fingerprint. Using the same comparator as every other
 *     ordered artifact means the planner, the lockfile writer, and this
 *     encoder cannot disagree about ordering.
 *   - **Omission normalized to empty.** `args` / `env` absent and `args: []` /
 *     `env: {}` describe identical behavior, so they must not produce
 *     different approval evidence and force a spurious re-prompt.
 *   - **Name-independent.** Neither the authored nor the effective server
 *     name participates. The effective identity is tracked separately by the
 *     receipt claim, so aliasing a server does not invalidate approval of the
 *     declaration itself, and two facets declaring identical servers under
 *     different names are recognized as identical.
 *
 * The version tag in the preimage makes the encoding itself versioned: a
 * future portable field forces a new tag rather than silently changing what
 * an existing stored fingerprint meant.
 */

/** Preimage tag. Bump only when the canonical encoding itself changes. */
const FINGERPRINT_ENCODING_TAG = 'facets:mcp-server:v1'

/** A declaration fingerprint, in the repository-wide `sha256:<hex>` form. */
export type McpServerFingerprint = `sha256:${string}`

/**
 * The exact bytes hashed for a declaration. Exported for tests and for any
 * other implementation of the specification that needs to reproduce the
 * digest — the encoding is normative, not an implementation detail.
 */
export function canonicalMcpServerEncoding(declaration: McpServerDeclaration): string {
  switch (declaration.type) {
    case 'stdio': {
      const args = declaration.args ?? []
      const env = Object.entries(declaration.env ?? {}).sort(([a], [b]) => compareCodeUnits(a, b))
      return JSON.stringify([FINGERPRINT_ENCODING_TAG, 'stdio', declaration.command, args, env])
    }
    case 'http':
      return JSON.stringify([FINGERPRINT_ENCODING_TAG, 'http', declaration.url])
  }
}

/**
 * Deterministic `sha256:<hex>` fingerprint of a declaration's canonical
 * semantic form.
 */
export function computeMcpServerFingerprint(declaration: McpServerDeclaration): McpServerFingerprint {
  const hex = createHash('sha256').update(canonicalMcpServerEncoding(declaration), 'utf8').digest('hex')
  return `sha256:${hex}`
}
