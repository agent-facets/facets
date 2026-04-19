import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addCommand } from '../index.ts'

let projectRoot: string
let originalCwd: string
let fixtureGitRepo: string

function git(args: string[], cwd?: string) {
  return Bun.spawnSync(['git', ...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } as Record<string, string>,
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

beforeEach(() => {
  originalCwd = process.cwd()
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-add-root-')))
  process.chdir(projectRoot)

  // Build a fixture git repo that ships a minimal facet.
  fixtureGitRepo = realpathSync(mkdtempSync(join(tmpdir(), 'facet-add-fixture-')))
  writeFileSync(
    join(fixtureGitRepo, 'facet.json'),
    JSON.stringify({
      name: 'viper-plans',
      version: '0.1.0',
      skills: { planning: { description: 'plan things' } },
    }),
  )
  mkdirSync(join(fixtureGitRepo, 'skills/planning'), { recursive: true })
  writeFileSync(join(fixtureGitRepo, 'skills/planning/SKILL.md'), '# planning')

  git(['init', '-q', '-b', 'main'], fixtureGitRepo)
  git(['config', 'user.email', 'test@example.com'], fixtureGitRepo)
  git(['config', 'user.name', 'Test'], fixtureGitRepo)
  git(['add', '.'], fixtureGitRepo)
  git(['commit', '-q', '-m', 'initial'], fixtureGitRepo)
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(projectRoot, { recursive: true, force: true })
  rmSync(fixtureGitRepo, { recursive: true, force: true })
})

describe('facet add — git source', () => {
  test('clones, reads facet.json, and writes facets.json', async () => {
    const code = await addCommand.run([`git+file://${fixtureGitRepo}#main`], {})
    expect(code).toBe(0)

    const raw = readFileSync(join(projectRoot, 'facets.json'), 'utf8')
    const json = JSON.parse(raw)
    expect(json.facets['viper-plans']).toBe(`git+file://${fixtureGitRepo}#main`)
  })

  test('updates an existing facets.json by upserting', async () => {
    writeFileSync(join(projectRoot, 'facets.json'), JSON.stringify({ facets: { 'other-facet': 'github:x/y#main' } }))
    const code = await addCommand.run([`git+file://${fixtureGitRepo}#main`], {})
    expect(code).toBe(0)
    const json = JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8'))
    expect(json.facets['other-facet']).toBe('github:x/y#main')
    expect(json.facets['viper-plans']).toBe(`git+file://${fixtureGitRepo}#main`)
  })

  test('prints the success line with facet name + version', async () => {
    const chunks: string[] = []
    const orig = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((c: unknown) => {
      chunks.push(String(c))
      return true
    }) as typeof process.stdout.write
    try {
      await addCommand.run([`git+file://${fixtureGitRepo}#main`], {})
    } finally {
      process.stdout.write = orig
    }
    const out = chunks.join('')
    expect(out).toContain('✓ Added viper-plans@0.1.0')
    expect(out).toContain("Run 'facet install' to materialize.")
  })
})

describe('facet add — local source', () => {
  test('resolves a local directory inside the project and writes facets.json', async () => {
    const localDir = join(projectRoot, 'facets/viper-plans')
    mkdirSync(localDir, { recursive: true })
    writeFileSync(
      join(localDir, 'facet.json'),
      JSON.stringify({
        name: 'viper-plans',
        version: '0.2.0',
        commands: { plan: { description: 'plan' } },
      }),
    )
    mkdirSync(join(localDir, 'commands'), { recursive: true })
    writeFileSync(join(localDir, 'commands/plan.md'), '# plan')

    const code = await addCommand.run(['file:./facets/viper-plans'], {})
    expect(code).toBe(0)
    const json = JSON.parse(readFileSync(join(projectRoot, 'facets.json'), 'utf8'))
    expect(json.facets['viper-plans']).toBe('file:./facets/viper-plans')
  })

  test('rejects a local path outside the project tree', async () => {
    const code = await addCommand.run([`file:/tmp/not-in-tree-${Date.now()}`], {})
    expect(code).toBe(1)
  })
})

describe('facet add — error paths', () => {
  test('missing source prints usage error', async () => {
    const code = await addCommand.run([], {})
    expect(code).toBe(1)
  })

  test('bare registry names are rejected in closed alpha', async () => {
    const code = await addCommand.run(['viper-plans'], {})
    expect(code).toBe(1)
  })

  test('unparseable specifier returns 1', async () => {
    const code = await addCommand.run(['ftp://no.good'], {})
    expect(code).toBe(1)
  })
})
