import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

const CLI_PATH = resolve(import.meta.dir, '../../dist/facet')

async function runCli(...args: string[]) {
  const proc = Bun.spawn([CLI_PATH, ...args], {
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  })
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  const exitCode = await proc.exited
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode }
}

describe('facet instructions', () => {
  test('default topic prints the overview and points at authoring', async () => {
    const result = await runCli('instructions')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('instructions for AI agents')
    expect(result.stdout).toContain('facet instructions authoring')
  })

  test('usage topic leads with the registry', async () => {
    const result = await runCli('instructions', 'usage')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('agentfacets.io')
    expect(result.stdout).toContain('facet add viper-plans')
  })

  test('manifest topic appends the generated JSON Schema', async () => {
    const result = await runCli('instructions', 'manifest')
    expect(result.exitCode).toBe(0)
    // The generated JSON Schema follows the "(generated)" marker; the prose
    // above it also contains braces, so split on the marker rather than the
    // first `{`.
    const marker = '(generated) ---'
    const markerIndex = result.stdout.indexOf(marker)
    expect(markerIndex).toBeGreaterThanOrEqual(0)
    const after = result.stdout.slice(markerIndex + marker.length)
    const schema = JSON.parse(after.slice(after.indexOf('{')))
    expect(schema.required).toContain('name')
    expect(schema.required).toContain('version')
    // The narrow business-rule predicate must not leak into the schema.
    expect(JSON.stringify(schema)).not.toContain('predicate')
  })

  test('unknown topic errors with exit 1 and lists valid topics', async () => {
    const result = await runCli('instructions', 'bogus')
    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('unknown instructions topic')
    expect(result.stderr).toContain('overview, manifest, authoring, usage')
  })

  test('help labels the command as FOR AI AGENTS', async () => {
    const result = await runCli('help')
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('FOR AI AGENTS')
  })
})
