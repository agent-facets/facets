/**
 * Shell, filesystem, build pipeline, CI tokens, and network operations.
 */

import { $ } from 'bun'
import { mintGitHubAppToken as mintGitHubAppTokenImpl } from '../github-app'

export const shellIo = {
  // Shell
  pack: (cwd: string) => $`bun pm pack`.cwd(cwd),
  chmod: (cwd: string) => $`chmod -R 755 .`.cwd(cwd).nothrow(),
  rm: (path: string) => $`rm -rf ${path}`.nothrow(),
  mkdir: (path: string) => $`mkdir -p ${path}`,
  sleep: (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms)),

  // CI tokens
  mintGitHubAppToken: () => mintGitHubAppTokenImpl(),
  mintCircleOidcToken: () => $`circleci run oidc get --claims '{"aud": "npm:registry.npmjs.org"}'`.text(),

  // Build pipeline
  changesetVersion: () => $`bun changeset version`,
  turboBuild: () => $`bun turbo build`,
  bunInstall: () => $`bun install`,
  publishCliPackage: () => $`bun scripts/release-cli/publish-cli-package.ts`,
  verifyPackages: (packages: string[], version: string) =>
    $`bun scripts/release-cli/verify.ts ${version} ${packages.join(',')}`,

  // Filesystem
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

  // Network
  httpPost: async (url: string, headers: Record<string, string>, body: unknown): Promise<Record<string, unknown>> => {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    return (await res.json()) as Record<string, unknown>
  },
}
