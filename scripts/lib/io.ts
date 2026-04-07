/**
 * I/O adapter — the single source of ALL external side effects.
 *
 * Every shell command, file operation, network call, and console output
 * goes through this object. Tests mock individual methods via spyOn(io, "method").
 *
 * NO logic lives here — only raw operations. Logic that composes these
 * operations belongs in domain-specific modules (ci.ts, npm.ts, etc.).
 */

import { $ } from 'bun'
import { GITHUB_REPO } from './constants'
import { mintGitHubAppToken as mintGitHubAppTokenImpl } from './github-app'

export const io = {
  // ---------------------------------------------------------------------------
  // npm CLI
  // ---------------------------------------------------------------------------
  whoami: () => $`npm whoami`.quiet(),
  viewName: (pkg: string) => $`npm view ${pkg} name`.quiet(),
  viewVersion: (pkg: string, ver: string) => $`npm view ${pkg}@${ver} version`.quiet(),
  viewDistTag: (pkg: string, tag: string) => $`npm view ${pkg}@${tag} version`.quiet(),
  publish: (cwd: string, tag: string) => $`npm publish *.tgz --access public --tag ${tag}`.cwd(cwd),
  publishPlain: (cwd: string) => {
    const proc = Bun.spawn(['npm', 'publish', '--access', 'public'], {
      cwd,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'pipe',
    })
    return proc.exited.then(async (code) => {
      if (code !== 0) {
        const stderr = await new Response(proc.stderr).text()
        console.error(stderr)
        throw new Error(stderr || `Failed with exit code ${code}`)
      }
    })
  },
  npmPublish: (dir: string) => $`npm publish --access public`.cwd(dir),
  npmViewVersion: async (pkg: string): Promise<string | null> => {
    const result = await $`npm view ${pkg} version`.nothrow().quiet()
    return result.exitCode === 0 ? result.text().trim() : null
  },

  // ---------------------------------------------------------------------------
  // Shell
  // ---------------------------------------------------------------------------
  pack: (cwd: string) => $`bun pm pack`.cwd(cwd),
  chmod: (cwd: string) => $`chmod -R 755 .`.cwd(cwd).nothrow(),
  rm: (path: string) => $`rm -rf ${path}`.nothrow(),
  mkdir: (path: string) => $`mkdir -p ${path}`,

  // ---------------------------------------------------------------------------
  // Git
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // GitHub CLI
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // CI tokens
  // ---------------------------------------------------------------------------
  mintGitHubAppToken: () => mintGitHubAppTokenImpl(),
  mintCircleOidcToken: () => $`circleci run oidc get --claims '{"aud": "npm:registry.npmjs.org"}'`.text(),

  // ---------------------------------------------------------------------------
  // Build pipeline
  // ---------------------------------------------------------------------------
  changesetVersion: () => $`bun changeset version`,
  turboBuild: () => $`bun turbo build`,
  bunInstall: () => $`bun install`,
  publishMainPackage: () => $`bun scripts/publish-main-package.ts`,
  verifyCli: (version: string) => $`bun scripts/verify-cli.ts ${version}`,
  promoteCli: (version: string) => $`bun scripts/promote-cli.ts ${version}`,

  // ---------------------------------------------------------------------------
  // Filesystem
  // ---------------------------------------------------------------------------
  readFile: (path: string) => Bun.file(path).text(),
  readJson: (path: string) => Bun.file(path).json(),
  writeFile: (path: string, content: string) => Bun.write(path, content),
  fileExists: (path: string) => Bun.file(path).exists(),

  globScan: async (pattern: string, opts?: { cwd?: string; onlyFiles?: boolean }): Promise<string[]> => {
    const entries: string[] = []
    for await (const entry of new Bun.Glob(pattern).scan(opts ?? {})) {
      entries.push(entry)
    }
    return entries
  },

  scanDir: async (dir: string): Promise<string[]> => {
    const entries: string[] = []
    for await (const entry of new Bun.Glob('*.md').scan(dir)) {
      entries.push(entry)
    }
    return entries
  },

  // ---------------------------------------------------------------------------
  // Network
  // ---------------------------------------------------------------------------
  httpPost: async (url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> => {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    return (await res.json()) as Record<string, unknown>
  },

  // ---------------------------------------------------------------------------
  // Console
  // ---------------------------------------------------------------------------
  log: (...args: unknown[]) => console.log(...args),
  error: (...args: unknown[]) => console.error(...args),
}
