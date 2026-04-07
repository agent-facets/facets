/**
 * IO adapter — a single location for all external side effects.
 *
 * All shell commands, file operations, and console output go through
 * this object. Tests mock individual methods via spyOn(io, "method").
 */

import { $ } from 'bun'
import type { WorkspacePackage } from './changesets'
import { GITHUB_REPO } from './constants'
import { mintGitHubAppToken } from './github-app'

export const io = {
  // GitHub App
  mintGitHubToken: () => mintGitHubAppToken(),

  // Changesets
  changesetVersion: () => $`bun changeset version`,

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
  gitFetch: (remote: string, branch: string) => $`git fetch ${remote} ${branch}`,
  gitFetchSha: (remote: string, sha: string) => $`git fetch ${remote} ${sha}`,

  gitTagAt: (tag: string, sha: string) => $`git tag ${tag} -m ${tag} ${sha}`,
  gitPushAllTags: (remote: string) => $`git push ${remote} --tags`,

  // GitHub CLI
  ghAuthSetupGit: () => $`gh auth setup-git`,
  ghPrList: (head: string) => $`gh pr list --head ${head} --state open --json number --jq .[0].number`.text(),
  ghPrCreate: (base: string, head: string, title: string, body: string) =>
    $`gh pr create --base ${base} --head ${head} --title ${title} --body ${body}`,
  ghPrUpdate: (prNumber: string, title: string, body: string) =>
    $`gh pr edit ${prNumber} --title ${title} --body ${body}`,
  ghGetPrForCommit: async (
    sha: string,
  ): Promise<Array<{ number: number; headRefName: string; headRefOid: string }>> => {
    const result =
      await $`gh api repos/${GITHUB_REPO}/commits/${sha}/pulls --jq '[.[] | {number, headRefName: .head.ref, headRefOid: .head.sha}]'`.text()
    return JSON.parse(result.trim() || '[]')
  },
  ghReleaseCreate: (tag: string, title: string, notes: string) =>
    $`gh release create ${tag} --title ${title} --notes ${notes}`.text(),

  // CircleCI OIDC
  mintOidcToken: () => $`circleci run oidc get --claims '{"aud": "npm:registry.npmjs.org"}'`.text(),

  // npm registry
  npmViewVersion: async (pkg: string): Promise<string | null> => {
    const result = await $`npm view ${pkg} version`.nothrow().quiet()
    return result.exitCode === 0 ? result.text().trim() : null
  },
  npmPublish: (dir: string) => $`npm publish --access public`.cwd(dir),

  // CLI binary pipeline
  buildCli: () => $`bun scripts/build-cli.ts`,
  publishMainPackage: () => $`bun scripts/publish-main-package.ts`,
  verifyCli: (version: string) => $`bun scripts/verify-cli.ts ${version}`,
  promoteCli: (version: string) => $`bun scripts/promote-cli.ts ${version}`,

  // Turbo
  turboBuild: () => $`bun turbo build`,

  // Dependencies
  bunInstall: () => $`bun install`,

  // Slack
  slackNotify: async (channels: string, text: string): Promise<void> => {
    const token = process.env.SLACK_ACCESS_TOKEN ?? process.env.SLACK_BOT_TOKEN ?? ''
    if (!token) {
      console.error('No Slack token found (SLACK_ACCESS_TOKEN or SLACK_BOT_TOKEN). Skipping notification.')
      return
    }
    for (const channel of channels.split(',').map((c) => c.trim())) {
      const res = await fetch('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, text }),
      })
      const body = (await res.json()) as { ok: boolean; error?: string }
      if (!body.ok) {
        console.error(`Slack API error for channel ${channel}: ${body.error}`)
      }
    }
  },

  // Console
  log: (...args: unknown[]) => console.log(...args),
  error: (...args: unknown[]) => console.error(...args),

  // Filesystem
  readFile: (path: string) => Bun.file(path).text(),
  writeFile: (path: string, content: string) => Bun.write(path, content),

  scanDir: async (dir: string): Promise<string[]> => {
    const entries: string[] = []

    for await (const entry of new Bun.Glob('*.md').scan(dir)) {
      entries.push(entry)
    }

    return entries
  },

  loadWorkspacePackages: async (): Promise<WorkspacePackage[]> => {
    const root = await Bun.file('package.json').json()
    const patterns: string[] = root.workspaces?.packages ?? root.workspaces ?? []
    const results: WorkspacePackage[] = []

    for (const pattern of patterns) {
      for await (const dir of new Bun.Glob(pattern).scan({ onlyFiles: false })) {
        const file = Bun.file(`${dir}/package.json`)
        if (await file.exists()) {
          const pkg = await file.json()
          results.push({ name: pkg.name, version: pkg.version, dir, private: pkg.private })
        }
      }
    }

    return results
  },
}

/**
 * Mint CI tokens and set them as environment variables.
 *
 * Always mints a GitHub App token (GH_TOKEN + GITHUB_TOKEN).
 * Optionally mints an OIDC token for npm trusted publishing (NPM_ID_TOKEN).
 */
export async function mintCiTokens(opts: { npm?: boolean } = {}): Promise<void> {
  const ghToken = await io.mintGitHubToken()
  process.env.GH_TOKEN = ghToken
  process.env.GITHUB_TOKEN = ghToken

  if (opts.npm) {
    const oidcToken = (await io.mintOidcToken()).trim()
    process.env.NPM_ID_TOKEN = oidcToken
  }
}
