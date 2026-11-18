import type { AnyCommand, FlagDef, FlagDefs, FlagPatternDef, FlagPatterns } from './command.ts'

export type ParsedFlags = { ok: true; args: string[]; flags: Record<string, unknown> } | { ok: false; message: string }

/** Options every command accepts, whatever it declares. */
export const GLOBAL_COMMAND_FLAGS = new Set(['json', 'help'])

type Resolved =
  | { kind: 'flag'; key: string; def: FlagDef }
  | { kind: 'negative'; key: string }
  | { kind: 'pattern'; key: string; def: FlagPatternDef }
  | { kind: 'global'; key: string }

/**
 * Parse the tokens after a command name against that command's declarations.
 * Only declared spellings are accepted: an unknown option, an undeclared
 * negative, a repeated single-value option, or a missing value is a failure
 * rather than something the handler might silently ignore. `operands` are
 * the tokens after `--`, appended verbatim.
 */
export function parseCommandFlags(command: AnyCommand, tokens: string[], operands: string[] = []): ParsedFlags {
  const defs: FlagDefs = command.flags ?? {}
  const patterns: FlagPatterns = command.patterns ?? {}
  const args: string[] = []
  const flags: Record<string, unknown> = {}

  const fail = (message: string): ParsedFlags => ({ ok: false, message })

  const assign = (
    key: string,
    def: FlagDef | FlagPatternDef,
    inline: string | undefined,
    spelling: string,
    index: number,
  ): { next: number } | string => {
    if (def.type === 'boolean') {
      if (inline === undefined) flags[key] = true
      else if (inline === 'true' || inline === 'false') flags[key] = inline === 'true'
      else return `${spelling} expects true or false, not "${inline}"`
      return { next: index }
    }
    let value = inline
    let next = index
    if (value === undefined) {
      const candidate = tokens[index + 1]
      if (candidate === undefined || (candidate.startsWith('-') && candidate !== '-'))
        return `${spelling} requires a value`
      value = candidate
      next = index + 1
    }
    if (def.type === 'string') {
      if (Object.hasOwn(flags, key)) return `${spelling} may only be given once`
      flags[key] = value
    } else {
      const existing = flags[key]
      flags[key] = Array.isArray(existing) ? [...existing, value] : [value]
    }
    return { next }
  }

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] ?? ''
    if (token === '-' || !token.startsWith('-')) {
      args.push(token)
      continue
    }

    if (token.startsWith('--')) {
      const body = token.slice(2)
      const eq = body.indexOf('=')
      const name = eq === -1 ? body : body.slice(0, eq)
      const inline = eq === -1 ? undefined : body.slice(eq + 1)
      const resolved = resolveLong(name, defs, patterns)
      if (resolved === undefined) return fail(`unknown option --${name}`)
      if (resolved.kind === 'global') {
        if (inline !== undefined && inline !== 'true' && inline !== 'false') {
          return fail(`--${name} expects true or false, not "${inline}"`)
        }
        flags[resolved.key] = inline !== 'false'
        continue
      }
      if (resolved.kind === 'negative') {
        if (inline !== undefined) return fail(`--${name} does not take a value`)
        flags[resolved.key] = false
        continue
      }
      const outcome = assign(resolved.key, resolved.def, inline, `--${name}`, i)
      if (typeof outcome === 'string') return fail(outcome)
      i = outcome.next
      continue
    }

    const letters = token.slice(1)
    if (letters.includes('=')) return fail(`short options do not take "=": ${token}`)
    if (letters.length === 1) {
      const key = shortKey(letters, defs)
      const def = key === undefined ? undefined : defs[key]
      if (key === undefined || def === undefined) return fail(`unknown option -${letters}`)
      const outcome = assign(key, def, undefined, `-${letters}`, i)
      if (typeof outcome === 'string') return fail(outcome)
      i = outcome.next
      continue
    }
    for (const letter of letters) {
      const key = shortKey(letter, defs)
      if (key === undefined || defs[key]?.type !== 'boolean') return fail(`unknown option -${letter} in ${token}`)
      flags[key] = true
    }
  }

  return { ok: true, args: [...args, ...operands], flags }
}

function resolveLong(name: string, defs: FlagDefs, patterns: FlagPatterns): Resolved | undefined {
  if (Object.hasOwn(defs, name)) {
    const def = defs[name]
    if (def !== undefined) return { kind: 'flag', key: name, def }
  }
  if (GLOBAL_COMMAND_FLAGS.has(name)) return { kind: 'global', key: name }
  for (const [key, def] of Object.entries(defs)) {
    if (def.type === 'boolean' && def.negative?.name === name) return { kind: 'negative', key }
  }
  const prefixes = Object.keys(patterns).sort((a, b) => b.length - a.length)
  for (const prefix of prefixes) {
    const def = patterns[prefix]
    if (def !== undefined && name.startsWith(prefix) && name.length > prefix.length) {
      return { kind: 'pattern', key: name, def }
    }
  }
  return undefined
}

function shortKey(letter: string, defs: FlagDefs): string | undefined {
  for (const [key, def] of Object.entries(defs)) if (def.short === letter) return key
  return undefined
}
