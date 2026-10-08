import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { chmodSync, lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { OAuthSessionBinding } from '../oauth-store.ts'

const binding = {
  registry_origin: 'https://registry.example.test',
  client_id: 'client_public_123',
  issuer: 'https://login.example.test',
  authorization_endpoint: 'https://login.example.test/oauth/authorize',
  token_endpoint: 'https://login.example.test/oauth/token',
  verification_origin: 'https://login.example.test',
} satisfies OAuthSessionBinding

let facetDir: string

beforeEach(() => {
  facetDir = realpathSync(mkdtempSync(join(tmpdir(), 'oauth-store-e2e-')))
  chmodSync(facetDir, 0o700)
})

afterEach(() => {
  rmSync(facetDir, { recursive: true, force: true })
})

describe('compiled OAuth store', () => {
  test('runs the SQLite-backed store from a compiled Bun executable', async () => {
    const ownerUid = process.getuid?.()
    if (ownerUid === undefined) expect.unreachable('OAuth store e2e requires a POSIX host')
    const script = join(facetDir, 'compiled-smoke.ts')
    const executable = join(facetDir, 'compiled-smoke')
    writeFileSync(
      script,
      `
        import { withOAuthSessionLock } from ${JSON.stringify(modulePath())}
        const binding = JSON.parse(process.env.OAUTH_BINDING ?? '')
        const result = await withOAuthSessionLock(binding, async () => ({ ok: true, value: 'compiled-ok' }))
        if (!result.ok) throw new Error(result.error.code)
        process.stdout.write(result.value)
      `,
    )
    const built = Bun.spawn([process.execPath, 'build', '--compile', script, '--outfile', executable], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const buildOutput = await collect(built)
    if (buildOutput.exitCode !== 0) throw new Error(`compiled smoke build failed: ${buildOutput.stderr}`)

    const smoke = Bun.spawn([executable], {
      env: { ...process.env, FACET_DIR: facetDir, OAUTH_BINDING: JSON.stringify(binding) },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const smokeOutput = await collect(smoke)
    expect(smokeOutput.exitCode).toBe(0)
    expect(smokeOutput.stderr).toBe('')
    expect(smokeOutput.stdout).toBe('compiled-ok')
    const root = join(facetDir, 'oauth')
    const key = createHash('sha256').update(binding.registry_origin).digest('hex')
    const lock = lstatSync(join(root, `${key}.lock.sqlite`))
    expect(lstatSync(root).mode & 0o777).toBe(0o700)
    expect(lock.isFile()).toBe(true)
    expect(lock.mode & 0o777).toBe(0o600)
    expect(lock.uid).toBe(ownerUid)
    expect(lock.nlink).toBe(1)
  })
})

function modulePath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'oauth-store.ts')
}

interface PipedSubprocess {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  exited: Promise<number>
}

async function collect(child: PipedSubprocess): Promise<{
  exitCode: number
  stdout: string
  stderr: string
}> {
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}
