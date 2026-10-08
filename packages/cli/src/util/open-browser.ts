export type BrowserSpawnOptions = {
  readonly stdin: 'ignore'
  readonly stdout: 'ignore'
  readonly stderr: 'ignore'
}

export type BrowserProcess = {
  readonly exited: Promise<number>
  readonly signalCode: unknown | null
}

export type BrowserSpawn = (command: string[], options: BrowserSpawnOptions) => BrowserProcess

export type OpenBrowserResult =
  | { readonly ok: true }
  | {
      readonly ok: false
      readonly code: 'INVALID_URL' | 'UNSUPPORTED_PLATFORM' | 'LAUNCH_FAILED'
    }

export type OpenBrowserOptions = {
  readonly platform?: NodeJS.Platform
  readonly spawn?: BrowserSpawn
}

const IGNORED_STDIO = {
  stdin: 'ignore',
  stdout: 'ignore',
  stderr: 'ignore',
} satisfies BrowserSpawnOptions

const defaultSpawn: BrowserSpawn = (command, options) => Bun.spawn(command, options)

function browserCommand(platform: NodeJS.Platform, url: string): string[] | null {
  switch (platform) {
    case 'darwin':
      return ['open', url]
    case 'linux':
      return ['xdg-open', url]
    case 'win32':
      return ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
    default:
      return null
  }
}

function isValidHttpsUrl(value: string): boolean {
  if (value.trim() !== value) return false
  for (const character of value) {
    const codePoint = character.codePointAt(0)
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) return false
  }

  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.username.length === 0 && url.password.length === 0
  } catch {
    return false
  }
}

export async function openBrowser(url: string, options: OpenBrowserOptions = {}): Promise<OpenBrowserResult> {
  if (!isValidHttpsUrl(url)) return { ok: false, code: 'INVALID_URL' }

  const command = browserCommand(options.platform ?? process.platform, url)
  if (command === null) return { ok: false, code: 'UNSUPPORTED_PLATFORM' }

  try {
    const process = (options.spawn ?? defaultSpawn)(command, IGNORED_STDIO)
    const exitCode = await process.exited
    if (exitCode !== 0 || process.signalCode !== null) {
      return { ok: false, code: 'LAUNCH_FAILED' }
    }
    return { ok: true }
  } catch {
    return { ok: false, code: 'LAUNCH_FAILED' }
  }
}
