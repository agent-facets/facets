/**
 * I/O adapter — the single source of ALL external side effects.
 *
 * Every shell command, file operation, network call, and console output
 * goes through this object. Tests mock individual methods via spyOn(io, "method").
 *
 * NO logic lives here — only raw operations. Logic that composes these
 * operations belongs in domain-specific modules (ci.ts, npm.ts, etc.).
 *
 * Split into domain files for readability:
 * - npm.ts    — npm CLI commands
 * - git.ts    — git CLI commands
 * - github.ts — GitHub CLI commands
 * - shell.ts  — shell, filesystem, build pipeline, CI tokens, network
 * - console.ts — log and error output
 */

import { consoleIo } from './console'
import { gitIo } from './git'
import { githubIo } from './github'
import { npmIo } from './npm'
import { shellIo } from './shell'

export const io = {
  ...npmIo,
  ...gitIo,
  ...githubIo,
  ...shellIo,
  ...consoleIo,
}
