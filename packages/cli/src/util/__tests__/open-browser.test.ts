import { describe, expect, test } from 'bun:test'
import { type BrowserProcess, type BrowserSpawn, type BrowserSpawnOptions, openBrowser } from '../open-browser.ts'

const APPROVED_URL = 'https://login.agentfacets.io/auth/onboarding'

function completedProcess(exitCode = 0, signalCode: unknown | null = null): BrowserProcess {
  return {
    exited: Promise.resolve(exitCode),
    signalCode,
  }
}

function recordingSpawn(process: BrowserProcess = completedProcess()) {
  const calls: { command: string[]; options: BrowserSpawnOptions }[] = []
  const spawn: BrowserSpawn = (command, options) => {
    calls.push({ command: [...command], options: { ...options } })
    return process
  }
  return { calls, spawn }
}

describe('openBrowser', () => {
  test.each([
    ['darwin', ['open', APPROVED_URL]],
    ['linux', ['xdg-open', APPROVED_URL]],
    ['win32', ['rundll32.exe', 'url.dll,FileProtocolHandler', APPROVED_URL]],
  ] satisfies [
    NodeJS.Platform,
    string[],
  ][])('launches on %s with direct executable argv and ignored stdio', async (platform, expectedCommand) => {
    const { calls, spawn } = recordingSpawn()

    const result = await openBrowser(APPROVED_URL, { platform, spawn })

    expect(result).toEqual({ ok: true })
    expect(calls).toEqual([
      {
        command: expectedCommand,
        options: { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
      },
    ])
  })

  test('keeps shell metacharacters inside one URL argument', async () => {
    const hostileUrl = "https://login.agentfacets.io/verification?value=$(touch%20/tmp/pwned);echo&next='quoted'"
    const { calls, spawn } = recordingSpawn()

    const result = await openBrowser(hostileUrl, { platform: 'linux', spawn })

    expect(result).toEqual({ ok: true })
    expect(calls[0]?.command).toEqual(['xdg-open', hostileUrl])
    expect(calls[0]?.command).toHaveLength(2)
  })

  test.each([
    'http://login.agentfacets.io/auth/onboarding',
    'ftp://login.agentfacets.io/auth/onboarding',
    'javascript:alert(1)',
    'https://user:secret@login.agentfacets.io/auth/onboarding',
    'https://login.agentfacets.io/auth/onboarding\n--new-window',
    'https://login.agentfacets.io/auth/onboarding\r--new-window',
    ' https://login.agentfacets.io/auth/onboarding',
    'not a URL',
  ])('rejects unsafe or malformed input without spawning: %s', async (url) => {
    const spawn: BrowserSpawn = () => {
      throw new Error('spawn must not run')
    }

    const result = await openBrowser(url, { platform: 'darwin', spawn })

    expect(result).toEqual({ ok: false, code: 'INVALID_URL' })
  })

  test('returns a structured unsupported-platform result without spawning', async () => {
    const spawn: BrowserSpawn = () => {
      throw new Error('spawn must not run')
    }

    const result = await openBrowser(APPROVED_URL, { platform: 'freebsd', spawn })

    expect(result).toEqual({ ok: false, code: 'UNSUPPORTED_PLATFORM' })
  })

  test('converts a missing opener binary into a fixed launch failure', async () => {
    const spawn: BrowserSpawn = () => {
      throw new Error(`ENOENT: ${APPROVED_URL}`)
    }

    const result = await openBrowser(APPROVED_URL, { platform: 'linux', spawn })

    expect(result).toEqual({ ok: false, code: 'LAUNCH_FAILED' })
    expect(JSON.stringify(result)).not.toContain(APPROVED_URL)
  })

  test('converts a nonzero opener exit into a fixed launch failure', async () => {
    const { spawn } = recordingSpawn(completedProcess(127))

    const result = await openBrowser(APPROVED_URL, { platform: 'darwin', spawn })

    expect(result).toEqual({ ok: false, code: 'LAUNCH_FAILED' })
  })

  test('converts a signaled opener into a fixed launch failure', async () => {
    const { spawn } = recordingSpawn(completedProcess(0, 'SIGTERM'))

    const result = await openBrowser(APPROVED_URL, { platform: 'win32', spawn })

    expect(result).toEqual({ ok: false, code: 'LAUNCH_FAILED' })
  })
})
