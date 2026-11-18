import type { JsonResult } from './util/json-output.ts'

type LowercaseLetter =
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z'

/**
 * A flag's single-character short form. Spelled as a letter union rather
 * than `string` so `short: 'latest'` — which would parse as five clustered
 * one-letter flags, not one long one — cannot be written in the first
 * place.
 */
export type ShortFlagName = LowercaseLetter | Uppercase<LowercaseLetter>

interface FlagBase {
  /**
   * Optional one-character alias. `-L` and `--latest` are the same flag:
   * the router hands the handler only the canonical long name, and help
   * renders both forms from this one declaration.
   */
  short?: ShortFlagName
  /** Help text. Required, so no accepted spelling can be undocumented. */
  description: string
}

export interface BooleanFlagDef extends FlagBase {
  type: 'boolean'
  /**
   * A `--<name>` spelling that sets this flag to `false`, with its own help
   * line. Only a declared negative is accepted; `--no-<flag>` is not implied.
   */
  negative?: { name: string; description: string }
}

export interface ValueFlagDef extends FlagBase {
  /** `array` collects every occurrence into `string[]`. */
  type: 'string' | 'array'
  /** The help placeholder, rendered as `--<flag> <valueName>`. */
  valueName: string
}

export type FlagDef = BooleanFlagDef | ValueFlagDef

export type FlagDefs = Readonly<Record<string, FlagDef>>

/**
 * A documented family of flags sharing a prefix, such as
 * `--adapter-<name> <json>`. The handler receives the full flag name as
 * the key.
 */
export type FlagPatternDef =
  | { type: 'boolean'; nameLabel: string; description: string }
  | { type: 'string'; nameLabel: string; valueName: string; description: string }

/** Keyed by the literal prefix, including its trailing `-`. */
export type FlagPatterns = Readonly<Record<string, FlagPatternDef>>

/** No declarations: the default for a command without flags or patterns. */
export type None = Record<never, never>

type ValueOf<D> = D extends { type: 'boolean' } ? boolean : D extends { type: 'string' } ? string : string[]

/**
 * What a handler receives: exactly the declared flags, the declared
 * pattern families, and the global `json` switch. Reading anything else
 * is a type error.
 */
export type FlagValues<F extends FlagDefs, P extends FlagPatterns = None> = {
  -readonly [K in keyof F]?: ValueOf<F[K]>
} & { -readonly [K in keyof P & string as `${K}${string}`]?: ValueOf<P[K]> } & { json?: boolean }

export interface CommandContext {
  onJsonDocument?: (document: unknown) => void
}

export interface Command<F extends FlagDefs, P extends FlagPatterns = None> {
  name: string
  description: string
  usage?: string
  flags?: F
  patterns?: P
  /**
   * Alternate names that resolve to this same command. Aliases inherit
   * everything (description, flags, behavior) — including the canonical
   * `name` shown in per-command help.
   */
  aliases?: string[]
  /**
   * True when the command is wired to a real implementation. Absent or
   * false marks a stub — stubs are hidden from `facet --help` but still
   * invocable so typos surface helpful "did you mean…" suggestions.
   */
  implemented?: boolean
  run(args: string[], flags: FlagValues<F, P>, context?: CommandContext): Promise<number>
  /**
   * Machine-readable execution for `--json`. Required: a command cannot be
   * registered without deciding what its JSON result is, even if that
   * result is a structured refusal (as `edit` returns).
   */
  runJson(args: string[], flags: FlagValues<F, P>): Promise<JsonResult>
}

// biome-ignore lint/suspicious/noExplicitAny: the registry holds commands with differing flag sets
export type AnyCommand = Command<any, any>

/** Declare a command so its handlers are typed from its own flag declarations. */
export function defineCommand<const F extends FlagDefs = None, const P extends FlagPatterns = None>(
  command: Command<F, P>,
): Command<F, P> {
  return command
}

/**
 * A short-alias declaration that would make an invocation ambiguous.
 *
 * Both arms describe the same class of bug — two flags answering to one
 * spelling — but they are reached differently and read differently in
 * the message, so they stay separate.
 */
export type ShortFlagCollision =
  /** Two long flags claim the same short alias. */
  | { kind: 'duplicate-short'; short: ShortFlagName; first: string; second: string }
  /** A short alias is spelled the same as a long flag on the same command. */
  | { kind: 'short-shadows-long'; short: ShortFlagName; declaredBy: string }

/**
 * Every ambiguity in one command's short-alias declarations. Returns every
 * collision rather than the first, so a registry with more than one is
 * repaired in a single pass.
 */
export function findShortFlagCollisions(flags: FlagDefs): ShortFlagCollision[] {
  const collisions: ShortFlagCollision[] = []
  const claimedBy = new Map<ShortFlagName, string>()
  const longNames = new Set(Object.keys(flags))

  for (const [name, def] of Object.entries(flags)) {
    const short = def.short
    if (short === undefined) continue

    const first = claimedBy.get(short)
    if (first === undefined) claimedBy.set(short, name)
    else collisions.push({ kind: 'duplicate-short', short, first, second: name })

    if (longNames.has(short)) collisions.push({ kind: 'short-shadows-long', short, declaredBy: name })
  }

  return collisions
}

/** One collision, phrased for the invariant failure that reports it. */
export function describeShortFlagCollision(collision: ShortFlagCollision): string {
  switch (collision.kind) {
    case 'duplicate-short':
      return `-${collision.short} is claimed by both --${collision.first} and --${collision.second}`
    case 'short-shadows-long':
      return `-${collision.short} is claimed by --${collision.declaredBy} but --${collision.short} is also a flag`
  }
}
