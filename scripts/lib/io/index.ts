/**
 * I/O adapter — the single source of ALL external side effects.
 *
 * Every shell command, file operation, network call, and console output
 * goes through this object. Tests mock individual methods via
 * spyOn(io.<domain>, "method").
 *
 * NO logic lives here — only raw operations. Logic that composes these
 * operations belongs in domain-specific modules (ci.ts, npm.ts, etc.).
 *
 * Split into domain namespaces:
 * - io.npm      — npm CLI commands
 * - io.git      — git CLI commands
 * - io.gh       — GitHub CLI commands
 * - io.circleci — CircleCI API v2 calls
 * - io.shell    — shell, filesystem, build pipeline, CI tokens, network
 * - io.console  — log and error output
 */

import { circleciIo } from './circleci'
import { consoleIo } from './console'
import { gitIo } from './git'
import { githubIo } from './github'
import { npmIo } from './npm'
import { shellIo } from './shell'

export const io = {
  npm: npmIo,
  git: gitIo,
  gh: githubIo,
  circleci: circleciIo,
  shell: shellIo,
  console: consoleIo,
}
