import { type } from 'arktype'
import { validateAssetNameSegment } from './asset-name.ts'
import type { McpServerDeclaration } from './mcp-server-declaration.ts'

/**
 * Portable MCP server declarations — the connection and launch information a
 * facet author writes in `facet.json` so every selected adapter can configure
 * the same server in its own tool-native project configuration.
 *
 * The declaration is a **closed tagged union** with exactly two arms:
 *
 *   - `stdio` — launch a local process and speak MCP over its standard I/O.
 *   - `http`  — connect to a Streamable HTTP endpoint.
 *
 * Deliberately absent: headers, credentials, secrets, OAuth, variable
 * substitution, working directories, shell behavior, transport tuning, and
 * per-tool policy. Those are either authentication (the target tool's job) or
 * outside the safe intersection of the first-party tools, and adding them
 * later requires an explicit schema revision rather than silent tolerance.
 *
 * Unlike the rest of the manifest, declaration objects REJECT unrecognized
 * members (`'+': 'reject'`). This is an intentional exception to the
 * manifest's general extension tolerance: every field here affects process
 * execution or network access, so a member one consumer ignores and another
 * interprets would let two tools run materially different configurations
 * while both reported successful validation. Top-level and asset-descriptor
 * extension tolerance is unchanged — only these objects are closed.
 *
 * Values are literal. Nothing in a declaration is expanded, interpolated, or
 * normalized: an `env` value is the exact string the tool receives, and a URL
 * is preserved as authored rather than re-serialized by the parser.
 */

/**
 * The portable environment-variable name grammar: an ASCII letter or
 * underscore, followed by ASCII letters, digits, or underscores.
 *
 * Intentionally narrower than what a POSIX shell will accept. The name has to
 * survive a JSON map key, a JSONC map key, and a TOML bare or quoted key
 * without changing meaning, so the grammar is the portable intersection
 * rather than any one platform's maximum.
 */
const ENVIRONMENT_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Validate one environment-variable name. Errors are data, not exceptions,
 * matching the asset-name and facet-name validators so all three compose
 * identically into an arktype `ctx.mustBe(...)`.
 */
export function validateMcpEnvironmentName(value: string): { ok: true } | { ok: false; reason: string } {
  if (value === '') {
    return { ok: false, reason: 'must not be empty' }
  }
  if (!ENVIRONMENT_NAME_RE.test(value)) {
    return {
      ok: false,
      reason: 'must start with an ASCII letter or underscore and contain only ASCII letters, digits, and underscores',
    }
  }
  return { ok: true }
}

/**
 * Validate one authored server name.
 *
 * Server names reuse the single-segment asset-name grammar so exactly one
 * spelling is portable across a JSON object key, a JSONC object key, and a
 * TOML table key. Servers still occupy a namespace separate from text assets
 * — a facet may declare both a skill and a server called `review` — so this
 * shares the grammar without sharing the identity space.
 */
export function validateMcpServerName(value: string): { ok: true } | { ok: false; reason: string } {
  return validateAssetNameSegment(value)
}

/**
 * Whether a URL is an absolute `http:` or `https:` endpoint carrying no
 * embedded credentials.
 *
 * Relative references are rejected because a declaration has no base to
 * resolve against. `file:`, `ws:`, and `wss:` are rejected because the
 * portable model covers Streamable HTTP only. User-info (`https://u:p@host`)
 * is rejected because it is a credential, and credentials are out of scope by
 * contract — accepting one here would smuggle a secret into an
 * integrity-protected, publishable artifact.
 */
function validateHttpUrl(value: string): { ok: true } | { ok: false; reason: string } {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { ok: false, reason: 'an absolute http: or https: URL' }
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, reason: `an http: or https: URL, not ${url.protocol}` }
  }
  if (url.username !== '' || url.password !== '') {
    return { ok: false, reason: 'a URL without embedded credentials' }
  }
  return { ok: true }
}

/**
 * The command and URL constraints live on their own field schemas rather than
 * on the declaration object.
 *
 * An object-level narrow reports its failure at the declaration itself, so a
 * caller receives `servers.<name>` and has to read prose to learn which member
 * was wrong. Applied here, the same rule produces `servers.<name>.command` or
 * `servers.<name>.url` — a path a caller can act on without parsing a message.
 */
const McpCommand = type('string').narrow((value, ctx) => (value === '' ? ctx.mustBe('a non-empty command') : true))

const McpHttpUrl = type('string').narrow((value, ctx) => {
  const check = validateHttpUrl(value)
  return check.ok ? true : ctx.mustBe(check.reason)
})

/**
 * A locally launched server. `command` is the executable as the tool will
 * invoke it; `args` preserves authored order, because argument order changes
 * behavior. Facets never locates, installs, or starts the command — the
 * declaration is configuration, not execution.
 *
 * `args` and `env` are optional, and an omitted collection is semantically
 * identical to an empty one everywhere the declaration is compared.
 */
const StdioMcpServerDeclaration = type({
  type: "'stdio'",
  command: McpCommand,
  'args?': 'string[]',
  'env?': type.Record('string', 'string'),
  '+': 'reject',
}).narrow((data, ctx) => {
  if (data.env === undefined) return true

  let valid = true
  for (const name of Object.keys(data.env)) {
    const check = validateMcpEnvironmentName(name)
    if (check.ok) continue
    // The invalid KEY is the failure's location, so the error is reported at
    // `env.<name>` rather than at the declaration with the name quoted into a
    // sentence. Every invalid key is reported, not just the first.
    ctx.reject({ expected: `an environment name that ${check.reason}`, relativePath: ['env', name] })
    valid = false
  }
  return valid
})

/**
 * A Streamable HTTP server. The absolute endpoint is the whole declaration:
 * headers and authentication belong to the target tool, which owns the
 * connection lifecycle after configuration is materialized.
 */
const HttpMcpServerDeclaration = type({
  type: "'http'",
  url: McpHttpUrl,
  '+': 'reject',
})

/**
 * One portable MCP server declaration.
 *
 * This schema and its inferred type are the single source of truth for the
 * shape. The Adapter SDK consumes the inferred type directly rather than
 * restating it, so an adapter's capability signature cannot drift from the
 * published contract.
 */
export const McpServerDeclarationSchema = StdioMcpServerDeclaration.or(HttpMcpServerDeclaration)

/** True only when `A` and `B` are mutually assignable. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false

/** Fails to compile unless its argument is exactly `true`. */
type Assert<T extends true> = T

/**
 * Compile-time proof that the dependency-free `McpServerDeclaration` and the
 * type `McpServerDeclarationSchema` actually infers describe the same shape.
 * Adding an arm, field, or optionality to the schema without updating the type
 * (or the reverse) makes this alias fail to compile — which is what makes the
 * split into two files a mechanically checked restatement rather than a second
 * definition free to drift.
 */
export type McpServerDeclarationSchemaAgreement = Assert<
  Exact<McpServerDeclaration, typeof McpServerDeclarationSchema.infer>
>
