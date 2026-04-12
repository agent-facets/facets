/**
 * Harness contract.
 *
 * A harness is an AI coding tool (OpenCode, Claude Code, Codex, etc.) that wraps
 * around an LLM and provides it with skills, agents, commands, and configuration.
 *
 * Harnesses provide tool-specific knowledge: directory mapping, config validation,
 * harness detection, and frontmatter assembly.
 */

export type AssetType = 'skills' | 'agents' | 'commands'

export interface ValidationResult {
  errors: Array<{ path: string; message: string }>
  warnings: string[]
}

export interface Harness {
  /** Harness identifier (e.g., "opencode", "claude-code", "codex") */
  name: string

  /** Root directory for this harness (e.g., ".opencode", ".claude") */
  rootDir: string

  /** Check if this harness is available/detected at the given project root */
  isAvailable(projectRoot: string): boolean | Promise<boolean>

  /** Validate harness-specific config from facet.json */
  validateConfig(data: unknown): ValidationResult

  /** Resolve the file path for an asset relative to the harness root */
  assetPath(type: AssetType, name: string): string
}

/**
 * Runtime constant exported from the contract package.
 * Used to verify that harnesses can resolve real JS values from @agent-facets/harness
 * at runtime (not just type-only imports that get erased).
 */
export const HARNESS_API_VERSION = 'spike-2026-04-12-runtime-proof'

/**
 * Helper to create an empty validation result.
 */
export function emptyValidationResult(): ValidationResult {
  return { errors: [], warnings: [] }
}
