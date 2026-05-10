import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { io } from './index'

describe('io.circleci.triggerPipelineForTag', () => {
  let originalFetch: typeof globalThis.fetch

  beforeEach(() => {
    originalFetch = globalThis.fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    mock.restore()
    delete process.env.CIRCLECI_API_TOKEN
  })

  test('throws when CIRCLECI_API_TOKEN is not set', async () => {
    delete process.env.CIRCLECI_API_TOKEN

    await expect(
      io.circleci.triggerPipelineForTag('gh/x/y', '9d2f5823-f2c9-4cba-918a-e7d0dc2f658a', 'some-tag'),
    ).rejects.toThrow(/CIRCLECI_API_TOKEN not set/)
  })

  test('throws with actionable error when definitionId is not a valid UUID', async () => {
    process.env.CIRCLECI_API_TOKEN = 'fake-token'
    const fetchSpy = mock(() => Promise.resolve(new Response('', { status: 200 })))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    // First segment is 10 chars instead of 8 — the exact bug that shipped to prod.
    await expect(
      io.circleci.triggerPipelineForTag('gh/x/y', '229d2f5823-f2c9-4cba-918a-e7d0dc2f658a', 'some-tag'),
    ).rejects.toThrow(/not a valid UUID/)

    // Critically: fetch must NOT have been called — we failed before hitting the API.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('rejects obviously-not-a-uuid values', async () => {
    process.env.CIRCLECI_API_TOKEN = 'fake-token'
    const fetchSpy = mock(() => Promise.resolve(new Response('', { status: 200 })))
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    await expect(io.circleci.triggerPipelineForTag('gh/x/y', 'not-a-uuid', 'some-tag')).rejects.toThrow(
      /not a valid UUID/,
    )
    await expect(io.circleci.triggerPipelineForTag('gh/x/y', '', 'some-tag')).rejects.toThrow(/not a valid UUID/)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  test('posts to CircleCI API with expected body when inputs are valid (no package param)', async () => {
    process.env.CIRCLECI_API_TOKEN = 'fake-token'
    const fetchSpy = mock((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ id: 'abc', number: 42 }), { status: 200 })),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    const result = await io.circleci.triggerPipelineForTag(
      'gh/agent-facets/facets',
      '9d2f5823-f2c9-4cba-918a-e7d0dc2f658a',
      'agent-facets@1.0.0',
    )

    expect(result).toEqual({ id: 'abc', number: 42 })
    expect(fetchSpy).toHaveBeenCalledTimes(1)

    const [url, init] = fetchSpy.mock.calls[0] ?? []
    expect(url).toBe('https://circleci.com/api/v2/project/gh/agent-facets/facets/pipeline/run')
    const headers = (init as RequestInit | undefined)?.headers as Record<string, string>
    expect(headers['Circle-Token']).toBe('fake-token')
    expect(headers['Content-Type']).toBe('application/json')

    const body = JSON.parse((init as RequestInit).body as string)
    // When no package name is supplied (release-cli trigger path), the
    // `parameters` key is omitted so the release-cli workflow doesn't
    // receive a stray parameter it doesn't declare.
    expect(body).toEqual({
      definition_id: '9d2f5823-f2c9-4cba-918a-e7d0dc2f658a',
      config: { tag: 'agent-facets@1.0.0' },
      checkout: { tag: 'agent-facets@1.0.0' },
    })
  })

  test('forwards packageName as `parameters.package` when provided', async () => {
    // Per-package `serial-group` keying on the `release` workflow depends on
    // this parameter being present in the API body. Without it, all scoped
    // package releases would serialize through the same queue.
    process.env.CIRCLECI_API_TOKEN = 'fake-token'
    const fetchSpy = mock((_url: string, _init?: RequestInit) =>
      Promise.resolve(new Response(JSON.stringify({ id: 'abc', number: 42 }), { status: 200 })),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    await io.circleci.triggerPipelineForTag(
      'gh/agent-facets/facets',
      '9d2f5823-f2c9-4cba-918a-e7d0dc2f658a',
      '@agent-facets/protocol@1.0.0',
      'core',
    )

    const [, init] = fetchSpy.mock.calls[0] ?? []
    const body = JSON.parse((init as RequestInit).body as string)
    expect(body).toEqual({
      definition_id: '9d2f5823-f2c9-4cba-918a-e7d0dc2f658a',
      config: { tag: '@agent-facets/protocol@1.0.0' },
      checkout: { tag: '@agent-facets/protocol@1.0.0' },
      parameters: { package: 'core' },
    })
  })

  test('throws with CircleCI error body on non-2xx response', async () => {
    process.env.CIRCLECI_API_TOKEN = 'fake-token'
    const fetchSpy = mock(() =>
      Promise.resolve(
        new Response(JSON.stringify({ message: "Field 'definition_id' must be a valid uuid." }), { status: 400 }),
      ),
    )
    globalThis.fetch = fetchSpy as unknown as typeof fetch

    await expect(
      io.circleci.triggerPipelineForTag(
        'gh/agent-facets/facets',
        '9d2f5823-f2c9-4cba-918a-e7d0dc2f658a',
        '@agent-facets/protocol@1.0.0',
      ),
    ).rejects.toThrow(/CircleCI pipeline trigger failed .* 400/)
  })
})
