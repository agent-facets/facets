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
