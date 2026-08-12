/**
 * The portable MCP server declaration type, and nothing else.
 *
 * This module is deliberately **dependency-free** — no arktype, no imports at
 * all — and is published as its own `@agent-facets/protocol/mcp-declaration`
 * entry point, mirroring the Adapter SDK's `api-version` subpath.
 *
 * The reason is the Adapter SDK. Its capability signatures are typed over this
 * declaration, and its published declarations inline everything they reference
 * so third-party adapter authors install one package. Reaching this type
 * through `@agent-facets/protocol`'s main entry would pull arktype's type graph
 * into every adapter author's project. Splitting the type out means the SDK
 * consumes the authoritative contract without acquiring a validator it never
 * calls.
 *
 * The validating schema lives beside this in `mcp-server.ts`, which imports
 * this type and asserts at compile time that the two agree. That file is the
 * place to read for what these fields *mean* and why the union is closed.
 */

/** The transports a portable declaration may use, in canonical order. */
export const MCP_SERVER_TRANSPORTS = ['stdio', 'http'] as const

/** A declared transport. */
export type McpServerTransport = (typeof MCP_SERVER_TRANSPORTS)[number]

/**
 * A validated portable MCP server declaration.
 *
 * A closed tagged union: `stdio` launches a local process and speaks MCP over
 * its standard I/O; `http` connects to a Streamable HTTP endpoint. Values are
 * literal — nothing here is expanded, interpolated, or normalized.
 *
 * An omitted `args` or `env` is semantically identical to an empty one
 * everywhere declarations are compared.
 */
export type McpServerDeclaration =
  | {
      type: 'stdio'
      command: string
      args?: string[]
      env?: Record<string, string>
    }
  | {
      type: 'http'
      url: string
    }

/**
 * Recursively readonly, distributed across a union.
 *
 * Deliberately local and unexported: it exists to derive one type below, and
 * a general-purpose deep-readonly utility on the published surface would
 * invite consumers to apply it to shapes it was never checked against.
 */
type DeepReadonly<T> = T extends readonly (infer Element)[]
  ? readonly DeepReadonly<Element>[]
  : T extends object
    ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
    : T

/**
 * A declaration a consumer may read but not modify.
 *
 * Derived from {@link McpServerDeclaration} rather than restated, so the two
 * cannot describe different shapes. Planning results expose this form: the
 * plan holds one frozen clone per contributed declaration, and its fingerprint
 * describes exactly that clone, so neither a consumer's edit nor a caller's
 * later mutation of its own input can leave the two disagreeing.
 */
export type ReadonlyMcpServerDeclaration = DeepReadonly<McpServerDeclaration>
