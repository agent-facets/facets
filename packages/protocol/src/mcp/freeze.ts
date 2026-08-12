import type { ReadonlyMcpServerDeclaration } from '../schemas/mcp-server-declaration.ts'

/**
 * One clone-and-freeze for portable MCP server declarations.
 *
 * A planner result is derived from declarations its caller still holds, and
 * the result carries a fingerprint computed from them. Sharing the caller's
 * object would make both claims conditional on the caller never touching it
 * again: a later edit would change what the plan says the server is while the
 * fingerprint kept describing what it used to be, and the planned,
 * configuration, and collision views — which deliberately share one object per
 * contribution — would all change together.
 *
 * So the planner clones once per contributed declaration, fingerprints the
 * clone, and hands the same frozen clone to every view. `Object.freeze` is
 * applied to the nested `args` and `env` too, because freezing only the outer
 * object leaves the parts that actually decide behavior writable.
 *
 * The `switch` is exhaustive on purpose: a future transport arm fails to
 * compile here rather than silently returning a shallow copy of a shape this
 * function has never seen.
 */
export function freezeMcpServerDeclaration(declaration: ReadonlyMcpServerDeclaration): ReadonlyMcpServerDeclaration {
  switch (declaration.type) {
    case 'stdio': {
      // Built as a mutable local so the optional members keep their authored
      // presence: an omitted `args` and an empty one mean the same thing to
      // the fingerprint, but the plan still reports the declaration as
      // written.
      const clone: {
        type: 'stdio'
        command: string
        args?: readonly string[]
        env?: Readonly<Record<string, string>>
      } = { type: 'stdio', command: declaration.command }

      if (declaration.args !== undefined) clone.args = Object.freeze([...declaration.args])
      if (declaration.env !== undefined) clone.env = Object.freeze({ ...declaration.env })

      return Object.freeze(clone)
    }
    case 'http':
      return Object.freeze({ type: 'http', url: declaration.url })
  }
}
