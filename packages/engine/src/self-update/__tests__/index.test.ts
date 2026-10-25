import { afterAll, afterEach, beforeEach, describe, expect, type Mock, spyOn, test } from 'bun:test'
import * as detectModule from '../detect.ts'
import { runSelfUpdate } from '../index.ts'
import * as miseModule from '../mise.ts'
import * as registryModule from '../registry.ts'
import * as versionCheckModule from '../version-check.ts'

// Spy on each dependency the orchestrator calls. We don't go through the
// real registry/detection/network paths — those are covered by their own
// unit tests. Here we verify the orchestration logic itself.

type DetectFn = typeof detectModule.detectInstallMethod
type GetLatestFn = typeof versionCheckModule.getLatestVersion
type ResolveMiseFn = typeof miseModule.resolveMiseInstall

const detectSpy = spyOn(detectModule, 'detectInstallMethod') as unknown as Mock<DetectFn>
const getLatestSpy = spyOn(versionCheckModule, 'getLatestVersion') as unknown as Mock<GetLatestFn>
const miseSpy = spyOn(miseModule, 'resolveMiseInstall') as unknown as Mock<ResolveMiseFn>

beforeEach(() => {
  detectSpy.mockClear()
  getLatestSpy.mockClear()
  miseSpy.mockClear()
  miseSpy.mockImplementation(async () => ({ kind: 'not-mise' }))
})

afterEach(() => {
  detectSpy.mockReset()
  getLatestSpy.mockReset()
  miseSpy.mockReset()
})

afterAll(() => {
  detectSpy.mockRestore()
  getLatestSpy.mockRestore()
  miseSpy.mockRestore()
})

/** Replace one method's `update` and `describe` with spies; returns them. */
function instrumentMethod(kind: keyof typeof registryModule.installMethods): {
  update: Mock<() => Promise<number>>
  describe: Mock<() => string>
} {
  const method = registryModule.installMethods[kind]
  const updateSpy = spyOn(method, 'update') as unknown as Mock<() => Promise<number>>
  const describeSpy = spyOn(method, 'describe') as unknown as Mock<() => string>
  return { update: updateSpy, describe: describeSpy }
}

describe('runSelfUpdate orchestration', () => {
  test('dev mode refuses without consulting the registry', async () => {
    detectSpy.mockImplementation(async () => 'local-dev')
    const { update } = instrumentMethod('local-dev')
    update.mockImplementation(async () => 1)

    const code = await runSelfUpdate({ currentVersion: '0.7.3', dryRun: false })

    expect(code).toBe(1)
    expect(update).toHaveBeenCalledTimes(1)
    // Critical: getLatestVersion must NOT have been called in dev mode.
    expect(getLatestSpy).toHaveBeenCalledTimes(0)
    update.mockRestore()
  })

  test('dev mode + --dry-run still refuses (no version probe)', async () => {
    detectSpy.mockImplementation(async () => 'local-dev')
    const { update } = instrumentMethod('local-dev')
    update.mockImplementation(async () => 1)

    const code = await runSelfUpdate({ currentVersion: '0.7.3', dryRun: true })

    expect(code).toBe(1)
    expect(getLatestSpy).toHaveBeenCalledTimes(0)
    update.mockRestore()
  })

  test('non-dev path resolves latest version when none pinned', async () => {
    detectSpy.mockImplementation(async () => 'npm')
    getLatestSpy.mockImplementation(async () => ({ ok: true, version: '0.7.3' })) // matches current
    const { update, describe } = instrumentMethod('npm')

    // currentVersion === target ⇒ "already up to date" short-circuit, no
    // call to update().
    const code = await runSelfUpdate({ currentVersion: '0.7.3', dryRun: false })

    expect(code).toBe(0)
    expect(getLatestSpy).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledTimes(0)
    update.mockRestore()
    describe.mockRestore()
  })

  test('pinned version skips the network probe', async () => {
    detectSpy.mockImplementation(async () => 'npm')
    const { update, describe } = instrumentMethod('npm')
    update.mockImplementation(async () => 0)

    await runSelfUpdate({ currentVersion: '0.7.3', targetVersion: '0.5.0', dryRun: false })

    expect(getLatestSpy).toHaveBeenCalledTimes(0)
    expect(update).toHaveBeenCalledTimes(1)
    // The orchestrator forwards targetVersion + dryRun + the optional
    // callbacks. Verify the version + dryRun are right; ignore the
    // callback identity.
    const firstCall = update.mock.calls[0] as unknown as [{ targetVersion: string; dryRun: boolean }] | undefined
    expect(firstCall).toBeDefined()
    if (firstCall) {
      expect(firstCall[0]?.targetVersion).toBe('0.5.0')
      expect(firstCall[0]?.dryRun).toBe(false)
    }
    update.mockRestore()
    describe.mockRestore()
  })

  test('--dry-run renders the plan and exits 0 without dispatching', async () => {
    detectSpy.mockImplementation(async () => 'npm')
    getLatestSpy.mockImplementation(async () => ({ ok: true, version: '0.8.0' }))
    const { update, describe } = instrumentMethod('npm')
    describe.mockImplementation(() => 'npm install -g agent-facets@0.8.0')

    const code = await runSelfUpdate({ currentVersion: '0.7.3', dryRun: true })

    expect(code).toBe(0)
    expect(update).toHaveBeenCalledTimes(0)
    update.mockRestore()
    describe.mockRestore()
  })

  test('non-dev path: getLatestVersion failure surfaces structured event and exits 1', async () => {
    detectSpy.mockImplementation(async () => 'npm')
    getLatestSpy.mockImplementation(async () => ({
      ok: false,
      reason: 'http',
      url: 'https://registry.npmjs.org/agent-facets/latest',
      status: 503,
    }))
    const { update } = instrumentMethod('npm')

    const events: import('../methods/types.ts').SelfUpdateErrorEvent[] = []
    const code = await runSelfUpdate({
      currentVersion: '0.7.3',
      dryRun: false,
      onError: (e) => {
        events.push(e)
      },
    })

    expect(code).toBe(1)
    expect(update).toHaveBeenCalledTimes(0)
    expect(events).toHaveLength(1)
    const event = events[0]
    if (event === undefined) expect.unreachable()
    if (event.kind !== 'latest-version-failure') expect.unreachable()
    if (event.failure.reason !== 'http') expect.unreachable()
    expect(event.failure.status).toBe(503)
    update.mockRestore()
  })

  test('ambiguous mise ownership emits guidance and never dispatches an updater', async () => {
    detectSpy.mockImplementation(async () => 'npm')
    miseSpy.mockImplementation(async () => ({ kind: 'guidance', reason: 'unsupported-tool' }))
    const { update } = instrumentMethod('npm')
    const events: import('../methods/types.ts').SelfUpdateErrorEvent[] = []

    const code = await runSelfUpdate({
      currentVersion: '0.7.3',
      targetVersion: '0.8.0',
      dryRun: false,
      onError: (event) => events.push(event),
    })

    expect(code).toBe(0)
    expect(update).toHaveBeenCalledTimes(0)
    expect(events).toEqual([
      {
        kind: 'mise-guidance',
        reason: 'unsupported-tool',
        command: "mise use 'github:agent-facets/facets[version_prefix=agent-facets@]@0.8.0'",
      },
    ])
    update.mockRestore()
  })

  test('dry-run reports the same config-preserving mise command it would execute', async () => {
    detectSpy.mockImplementation(async () => 'unknown')
    miseSpy.mockImplementation(async () => ({
      kind: 'updatable',
      install: {
        backend: 'github:agent-facets/facets',
        versionPrefix: 'agent-facets@',
        configPath: '/workspace/mise.toml',
      },
    }))
    const output: string[] = []

    const code = await runSelfUpdate({
      currentVersion: '0.7.3',
      targetVersion: '0.8.0',
      dryRun: true,
      onOutput: (line) => output.push(line),
    })

    expect(code).toBe(0)
    expect(output.join('')).toContain(
      "mise use --path /workspace/mise.toml 'github:agent-facets/facets[version_prefix=agent-facets@]@0.8.0'",
    )
  })
})
