import type { InstallMethod } from './types.ts'

/**
 * Default URL serving the canonical installer script. Lives in this repo
 * at `packages/landing/scripts/install.sh` and is delivered by the Lambda
 * at `packages/functions/src/install.ts`.
 *
 * `FACET_INSTALL_URL` overrides it for testing or self-hosted mirrors. Not
 * a user-facing flag — env var only.
 */
const INSTALLER_URL_DEFAULT = 'https://agentfacets.io/install'
const FETCH_TIMEOUT_MS = 10_000

function installerUrl(): string {
  return process.env.FACET_INSTALL_URL ?? INSTALLER_URL_DEFAULT
}

/**
 * Run the curl installer in-process. Streams the script body straight from
 * `fetch` into `bash -s`'s stdin — no temp files, no shell `<()`-style
 * process substitution.
 *
 * Exported so the `unknown` install method can reuse it: the same
 * mechanism handles "we know it's curl, don't touch PATH" and
 * "unclassified, please install fresh and fix PATH".
 */
export async function runCurlInstaller(targetVersion: string, opts: { modifyPath: boolean }): Promise<number> {
  const url = installerUrl()

  let installer: Response
  try {
    installer = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    process.stderr.write(`failed to fetch installer from ${url}: ${message}\n`)
    return 1
  }

  if (!installer.ok || installer.body === null) {
    process.stderr.write(`installer fetch returned HTTP ${installer.status}\n`)
    return 1
  }

  // `bash -s -- <args>` reads the script from stdin and forwards everything
  // after `--` as positional args to install.sh.
  const args = ['bash', '-s', '--', '--version', targetVersion]
  if (!opts.modifyPath) args.push('--no-modify-path')

  try {
    const proc = Bun.spawn(args, {
      stdin: installer,
      stdout: 'inherit',
      stderr: 'inherit',
    })
    return await proc.exited
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    process.stderr.write(`bash: ${message}\n`)
    return 1
  }
}

export const curlMethod: InstallMethod = {
  kind: 'curl',
  displayName: 'curl installer (~/.facet)',
  // The displayed command is informational — the real invocation streams
  // bytes into bash's stdin rather than going through a shell pipe.
  describe: ({ targetVersion }) =>
    `curl -fsSL ${installerUrl()} | bash -s -- --no-modify-path --version ${targetVersion}`,
  update: ({ targetVersion }) => runCurlInstaller(targetVersion, { modifyPath: false }),
}
