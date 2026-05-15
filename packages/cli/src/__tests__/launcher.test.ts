import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const LAUNCHER_PATH = resolve(import.meta.dir, '..', '..', 'bin', 'facet')

interface ExecResult {
  stdout: string
  stderr: string
  exitCode: number
}

async function runLauncher(args: string[] = [], env: Record<string, string> = {}): Promise<ExecResult> {
  const proc = Bun.spawn(['node', LAUNCHER_PATH, ...args], {
    env: { ...process.env, ...env },
    stdout: 'pipe',
    stderr: 'pipe',
  })

  const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
  const exitCode = await proc.exited

  return { stdout, stderr, exitCode }
}

describe('launcher — FACET_BIN_OVERRIDE', () => {
  let tmpDir: string
  let mockBinaryPath: string

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'launcher-test-'))
    mockBinaryPath = join(tmpDir, 'mock-facet')
    await writeFile(mockBinaryPath, '#!/bin/sh\necho "mock-facet: $@"\n')
    await chmod(mockBinaryPath, 0o755)
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  test('runs the binary at FACET_BIN_OVERRIDE', async () => {
    const result = await runLauncher(['--version'], { FACET_BIN_OVERRIDE: mockBinaryPath })
    expect(result.stdout).toContain('mock-facet:')
    expect(result.exitCode).toBe(0)
  })

  test('forwards arguments to the target binary', async () => {
    const result = await runLauncher(['build', '--force', 'my-dir'], { FACET_BIN_OVERRIDE: mockBinaryPath })
    expect(result.stdout).toContain('build --force my-dir')
  })
})

describe('launcher — forwards exit code', () => {
  let tmpDir: string
  let exitingBinaryPath: string

  beforeAll(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'launcher-exit-'))
    exitingBinaryPath = join(tmpDir, 'exit-42')
    await writeFile(exitingBinaryPath, '#!/bin/sh\nexit 42\n')
    await chmod(exitingBinaryPath, 0o755)
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  test('exits with the same code as the target binary', async () => {
    const result = await runLauncher([], { FACET_BIN_OVERRIDE: exitingBinaryPath })
    expect(result.exitCode).toBe(42)
  })
})

describe('launcher — no binary found', () => {
  let tmpDir: string
  let isolatedLauncherPath: string

  beforeAll(async () => {
    // Create an isolated copy of the launcher in a directory with no node_modules
    // and no cached .facet binary, so resolution falls through to the error path.
    tmpDir = await mkdtemp(join(tmpdir(), 'launcher-nobin-'))
    isolatedLauncherPath = join(tmpDir, 'facet')
    await Bun.write(isolatedLauncherPath, await Bun.file(LAUNCHER_PATH).text())
    await chmod(isolatedLauncherPath, 0o755)
  })

  afterAll(async () => {
    await rm(tmpDir, { recursive: true, force: true })
  })

  test('prints error with candidate package names and exits 1', async () => {
    const proc = Bun.spawn(['node', isolatedLauncherPath], {
      env: { ...process.env, FACET_BIN_OVERRIDE: undefined },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const stderr = await new Response(proc.stderr).text()
    const exitCode = await proc.exited

    expect(exitCode).toBe(1)
    expect(stderr).toContain('@agent-facets/cli-')
    expect(stderr).toContain('package manager failed')
  })
})
