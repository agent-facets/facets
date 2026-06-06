import { describe, expect, test } from 'bun:test'
import { cloneFailureToRunInstall } from '../clone-failure.ts'

describe('cloneFailureToRunInstall', () => {
  test('git-binary-missing → GIT_BINARY_MISSING', () => {
    expect(cloneFailureToRunInstall('cowsay', { ok: false, reason: 'git-binary-missing' })).toEqual({
      code: 'GIT_BINARY_MISSING',
      facet: 'cowsay',
    })
  })

  test('auth-required → GIT_AUTH_REQUIRED with url', () => {
    expect(cloneFailureToRunInstall('cowsay', { ok: false, reason: 'auth-required', url: 'https://x/r.git' })).toEqual({
      code: 'GIT_AUTH_REQUIRED',
      facet: 'cowsay',
      url: 'https://x/r.git',
    })
  })

  test('clone-failed → GIT_CLONE_FAILED with url + stderr', () => {
    expect(
      cloneFailureToRunInstall('cowsay', {
        ok: false,
        reason: 'clone-failed',
        url: 'https://x/r.git',
        stderr: 'boom',
      }),
    ).toEqual({ code: 'GIT_CLONE_FAILED', facet: 'cowsay', url: 'https://x/r.git', stderr: 'boom' })
  })

  test('checkout-failed → GIT_CHECKOUT_FAILED with commitish + stderr', () => {
    expect(
      cloneFailureToRunInstall('cowsay', {
        ok: false,
        reason: 'checkout-failed',
        url: 'https://x/r.git',
        commitish: 'abc123',
        stderr: 'nope',
      }),
    ).toEqual({
      code: 'GIT_CHECKOUT_FAILED',
      facet: 'cowsay',
      url: 'https://x/r.git',
      commitish: 'abc123',
      stderr: 'nope',
    })
  })
})
