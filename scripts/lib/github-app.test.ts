import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { GitHubAppTokenError } from './github-app'

// @octokit/auth-app exports a factory that returns the `auth` callable.
// We mock the factory so we can swap the auth callable per test.
const mockAuth = mock(() => Promise.resolve({ token: 'mock-token' }))

mock.module('@octokit/auth-app', () => ({
  createAppAuth: () => mockAuth,
}))

const ENV_KEYS = ['APP_ID', 'APP_PRIVATE_KEY_BASE64', 'APP_INSTALLATION_ID'] as const

function setRequiredEnv() {
  process.env.APP_ID = '12345'
  // base64("fake-key")
  process.env.APP_PRIVATE_KEY_BASE64 = 'ZmFrZS1rZXk='
  process.env.APP_INSTALLATION_ID = '67890'
}

function clearEnv() {
  for (const k of ENV_KEYS) delete process.env[k]
}

describe('mintGitHubAppToken', () => {
  beforeEach(() => {
    clearEnv()
    mockAuth.mockReset()
    mockAuth.mockResolvedValue({ token: 'mock-token' })
  })

  afterEach(() => {
    clearEnv()
  })

  test('returns the token on success', async () => {
    setRequiredEnv()
    const { mintGitHubAppToken } = await import('./github-app')

    const token = await mintGitHubAppToken()

    expect(token).toBe('mock-token')
  })

  test('throws GitHubAppTokenError when env vars are missing', async () => {
    // No env set.
    const { mintGitHubAppToken } = await import('./github-app')

    await expect(mintGitHubAppToken()).rejects.toBeInstanceOf(GitHubAppTokenError)
  })

  test('translates 404 into a runbook error naming APP_INSTALLATION_ID', async () => {
    setRequiredEnv()
    const httpError = Object.assign(new Error('Not Found'), { status: 404 })
    mockAuth.mockRejectedValueOnce(httpError)

    const { mintGitHubAppToken } = await import('./github-app')

    try {
      await mintGitHubAppToken()
      throw new Error('expected mintGitHubAppToken to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubAppTokenError)
      const message = (err as Error).message
      expect(message).toContain('APP_INSTALLATION_ID')
      expect(message).toContain('67890')
      expect(message).toContain('stale')
      // Preserves the underlying error as `cause` for debugging.
      expect((err as Error).cause).toBe(httpError)
    }
  })

  test('translates 401 into a runbook error naming APP_ID / APP_PRIVATE_KEY', async () => {
    setRequiredEnv()
    const httpError = Object.assign(new Error('Unauthorized'), { status: 401 })
    mockAuth.mockRejectedValueOnce(httpError)

    const { mintGitHubAppToken } = await import('./github-app')

    try {
      await mintGitHubAppToken()
      throw new Error('expected mintGitHubAppToken to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubAppTokenError)
      const message = (err as Error).message
      expect(message).toContain('APP_ID')
      expect(message).toContain('APP_PRIVATE_KEY_BASE64')
    }
  })

  test('wraps unexpected errors without dropping the original cause', async () => {
    setRequiredEnv()
    const boom = new Error('network exploded')
    mockAuth.mockRejectedValueOnce(boom)

    const { mintGitHubAppToken } = await import('./github-app')

    try {
      await mintGitHubAppToken()
      throw new Error('expected mintGitHubAppToken to throw')
    } catch (err) {
      expect(err).toBeInstanceOf(GitHubAppTokenError)
      expect((err as Error).message).toContain('network exploded')
      expect((err as Error).cause).toBe(boom)
    }
  })
})
