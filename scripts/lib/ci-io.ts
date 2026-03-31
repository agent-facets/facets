/**
 * IO adapter — a single location for all external side effects.
 *
 * All shell commands, file operations, and console output go through
 * this object. Tests mock individual methods via spyOn(io, "method").
 */

import { $ } from 'bun'
import { mintGitHubAppToken } from './github-app'

export const io = {
  // GitHub App
  mintGitHubToken: () => mintGitHubAppToken(),

  // Changesets
  changesetVersion: () => $`bun changeset version`,
  changesetPublish: () => $`bun changeset publish`,

  // Git
  gitDiff: () => $`git diff --quiet`.nothrow(),
  gitDiffCached: () => $`git diff --cached --quiet`.nothrow(),
  gitConfig: (key: string, value: string) => $`git config ${key} ${value}`,
  gitCheckout: (branch: string) => $`git checkout -B ${branch}`,
  gitAdd: () => $`git add -A`,
  gitCommit: (message: string) => $`git commit -m ${message}`,
  gitPush: (remote: string, ref: string, force = false) =>
    force ? $`git push ${remote} ${ref} --force` : $`git push ${remote} ${ref}`,
  gitPushTags: (remote: string, ref: string) => $`git push --follow-tags ${remote} ${ref}`,

  // GitHub CLI
  ghPrList: (head: string) => $`gh pr list --head ${head} --state open --json number --jq .[0].number`.text(),
  ghPrCreate: (base: string, head: string, title: string, body: string) =>
    $`gh pr create --base ${base} --head ${head} --title ${title} --body ${body}`,

  // CircleCI OIDC
  mintOidcToken: () => $`circleci run oidc get --claims '{"aud": "npm:registry.npmjs.org"}'`.text(),

  // Dependencies
  bunInstall: () => $`bun install`,

  // Console
  log: (...args: unknown[]) => console.log(...args),
  error: (...args: unknown[]) => console.error(...args),

  // Filesystem
  scanDir: async (dir: string): Promise<string[]> => {
    const entries: string[] = []
    for await (const entry of new Bun.Glob('*.md').scan(dir)) {
      entries.push(entry)
    }
    return entries
  },
}
