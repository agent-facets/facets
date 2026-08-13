import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { MaterializedAsset, ResolvedFacetManifest } from '@agent-facets/protocol'
import { adapterKey } from '@agent-facets/protocol'
import { FileTransaction } from '../../fs/index.ts'
import type { PreviousOwnership } from '../commit/ownership.ts'
import { deleteObsoleteAssets, materialize } from '../materialize.ts'
import { createTestAdapter, testAdapterSkillPath } from './helpers/test-adapter.ts'

/**
 * The install-level half of the transition matrix.
 *
 * The transaction's own guarantees — preflight, arming, savepoints,
 * coalescing, directory provenance — are proven in `src/fs/__tests__`, against
 * the kernel and with injected syscall faults. What is proven here is that an
 * *install* inherits them: that a skill bundle is one batch, that only real
 * mutation targets reach the journal, and that a concurrent edit survives a
 * rollback of the operation that touched it.
 */

let projectRoot: string

beforeEach(() => {
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-transitions-')))
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

const encode = (text: string): Uint8Array => new TextEncoder().encode(text)
const read = (path: string): string => readFileSync(path, 'utf8')

function manifestWith(skills: Record<string, { prompt: string; description?: string }> = {}): ResolvedFacetManifest {
  return { name: 'demo', version: '1.0.0', skills } as unknown as ResolvedFacetManifest
}

function skillAsset(name: string): MaterializedAsset {
  return {
    facet: 'demo',
    scope: 'project',
    type: 'skill',
    authoredName: name,
    effectiveName: name,
  } as MaterializedAsset
}

function ownership(entries: readonly PreviousOwnership[]): Map<string, PreviousOwnership> {
  return new Map(entries.map((entry) => [adapterKey(entry.scope, entry.type, entry.effectiveName), entry]))
}

async function installSkill(options: {
  transaction: FileTransaction
  adapterName?: string
  prompt: string
  companions?: Record<string, Uint8Array>
  owned?: readonly string[]
}) {
  const adapterName = options.adapterName ?? 'demo-tool'
  const companionBytes = new Map<string, Record<string, Uint8Array>>()
  if (options.companions) companionBytes.set('project:skill:planning', options.companions)

  return materialize({
    facetName: 'demo',
    manifest: manifestWith({ planning: { prompt: options.prompt, description: 'plan things' } }),
    projectRoot,
    adapters: [createTestAdapter(adapterName)],
    newAssets: [skillAsset('planning')],
    previousOwnership: ownership(
      options.owned === undefined
        ? []
        : [
            {
              scope: 'project',
              type: 'skill',
              effectiveName: 'planning',
              facets: ['demo'],
              ownedCompanionPaths: options.owned,
            },
          ],
    ),
    companionBytes: companionBytes as never,
    transaction: options.transaction,
  })
}

describe('a skill bundle is one batch', () => {
  test('primary and companions restore byte-for-byte after a rollback', async () => {
    // A previous run, committed. Its own transaction is discarded, so the
    // bundle it left is the pre-existing state the next run must restore.
    const previous = new FileTransaction()
    const first = await installSkill({
      transaction: previous,
      prompt: '# v1\n',
      companions: { 'references/api.md': encode('api v1\n'), 'scripts/run.sh': encode('#!/bin/sh\necho v1\n') },
    })
    expect(first.ok).toBe(true)
    const transaction = new FileTransaction()

    const primary = testAdapterSkillPath(projectRoot, 'demo-tool', 'planning')
    const api = join(dirname(primary), 'references', 'api.md')
    const script = join(dirname(primary), 'scripts', 'run.sh')
    chmodSync(script, 0o755)
    const before = { primary: read(primary), api: read(api), script: read(script), mode: statSync(script).mode & 0o777 }

    // A second install replaces the whole bundle. Rolling it back has to put
    // every file — and its permissions — back exactly.
    const second = await installSkill({
      transaction,
      prompt: '# v2\n',
      companions: { 'references/api.md': encode('api v2\n'), 'scripts/run.sh': encode('#!/bin/sh\necho v2\n') },
      owned: ['references/api.md', 'scripts/run.sh'],
    })
    expect(second.ok).toBe(true)
    expect(read(api)).toBe('api v2\n')

    const rollback = transaction.rollback()

    expect(rollback.kind).toBe('complete')
    expect(read(primary)).toBe(before.primary)
    expect(read(api)).toBe(before.api)
    expect(read(script)).toBe(before.script)
    expect(statSync(script).mode & 0o777).toBe(before.mode)
  })

  test('front matter survives a rollback exactly, including hand-written spacing', async () => {
    const transaction = new FileTransaction()
    const primary = testAdapterSkillPath(projectRoot, 'demo-tool', 'planning')
    mkdirSync(dirname(primary), { recursive: true })
    // Deliberately not the shape the SDK would emit: unusual spacing, a
    // comment, and a key order no serializer would reproduce.
    const handWritten = '---\nname:   planning\n# kept by hand\ndescription: plan things\n---\n# body\n'
    writeFileSync(primary, handWritten)

    const installed = await installSkill({ transaction, prompt: '# replaced\n' })
    expect(installed.ok).toBe(true)
    expect(read(primary)).not.toBe(handWritten)

    expect(transaction.rollback().kind).toBe('complete')
    // Restored from the exact prior bytes, so nothing had to re-serialize the
    // author's YAML — which no round trip could have reproduced.
    expect(read(primary)).toBe(handWritten)
  })

  test('a bundle whose primary is gone still removes its owned companions', async () => {
    const transaction = new FileTransaction()
    await installSkill({
      transaction,
      prompt: '# v1\n',
      companions: { 'notes.md': encode('notes\n') },
    })
    const primary = testAdapterSkillPath(projectRoot, 'demo-tool', 'planning')
    const notes = join(dirname(primary), 'notes.md')
    rmSync(primary)

    const cleanup = new FileTransaction()
    const deleted = await deleteObsoleteAssets({
      projectRoot,
      adapters: [createTestAdapter('demo-tool')],
      obsolete: [
        {
          scope: 'project',
          type: 'skill',
          effectiveName: 'planning',
          facets: ['demo'],
          ownedCompanionPaths: ['notes.md'],
        },
      ],
      transaction: cleanup,
    })

    if (!deleted.ok) expect.unreachable()
    expect(existsSync(notes)).toBe(false)

    // And it is restorable, which is what makes deleting it safe at all.
    expect(cleanup.rollback().kind).toBe('complete')
    expect(read(notes)).toBe('notes\n')
  })
})

describe('only real mutation targets are journaled', () => {
  test('a re-install that changes nothing journals nothing and touches no file', async () => {
    const transaction = new FileTransaction()
    await installSkill({ transaction, prompt: '# body\n', companions: { 'a.md': encode('a\n') } })
    transaction.rollback()

    const fresh = new FileTransaction()
    await installSkill({ transaction: fresh, prompt: '# body\n', companions: { 'a.md': encode('a\n') } })
    const primary = testAdapterSkillPath(projectRoot, 'demo-tool', 'planning')
    const before = statSync(primary)

    const again = new FileTransaction()
    const result = await installSkill({
      transaction: again,
      prompt: '# body\n',
      companions: { 'a.md': encode('a\n') },
      owned: ['a.md'],
    })

    if (!result.ok) expect.unreachable()
    expect(result.skipped).toBe(1)
    expect(result.written).toBe(0)
    expect(again.hasMutations()).toBe(false)
    expect(statSync(primary).mtimeMs).toBe(before.mtimeMs)
    expect(statSync(primary).ino).toBe(before.ino)
  })

  test('a file another process edits while the run works survives the rollback', async () => {
    const transaction = new FileTransaction()
    await installSkill({ transaction, prompt: '# v1\n' })

    // An unrelated file in the same tree — read by nothing this run mutates.
    const unrelated = join(projectRoot, '.demo-tool', 'skills', 'planning', 'user-notes.md')
    writeFileSync(unrelated, 'mine\n')

    expect(transaction.rollback().kind).toBe('complete')
    expect(read(unrelated)).toBe('mine\n')
  })

  test('a concurrent edit to a file this run wrote is preserved and reported', async () => {
    const transaction = new FileTransaction()
    await installSkill({ transaction, prompt: '# v1\n' })
    const primary = testAdapterSkillPath(projectRoot, 'demo-tool', 'planning')

    writeFileSync(primary, "somebody else's content\n")
    const rollback = transaction.rollback()

    if (rollback.kind !== 'incomplete') expect.unreachable()
    expect(rollback.issues).toHaveLength(1)
    expect(rollback.issues[0].kind).toBe('conflict')
    expect(rollback.issues[0].path).toBe(primary)
    expect(read(primary)).toBe("somebody else's content\n")
  })
})

describe('repeated mutations of one path', () => {
  test('two adapters writing one path coalesce to a single A → C transition', async () => {
    // Both adapters resolve the same base directory, so they target the same
    // file — the cross-adapter case the journal has to collapse rather than
    // stack.
    const shared = 'shared-tool'
    const transaction = new FileTransaction()

    await installSkill({ transaction, adapterName: shared, prompt: '# first\n' })
    const primary = testAdapterSkillPath(projectRoot, shared, 'planning')
    const original = read(primary)
    expect(transaction.journal()).toHaveLength(1)

    await installSkill({ transaction, adapterName: shared, prompt: '# second\n' })

    const journal = transaction.journal()
    expect(journal).toHaveLength(1)
    if (journal[0]?.original.kind !== 'absent') expect.unreachable()
    if (journal[0].committed.kind !== 'regular-file') expect.unreachable()
    expect(new TextDecoder().decode(journal[0].committed.contents)).not.toBe(original)

    expect(transaction.rollback().kind).toBe('complete')
    expect(existsSync(primary)).toBe(false)
  })
})

describe('directory cleanup', () => {
  test('directories the install created are removed, and pre-existing ones are not', async () => {
    const preExisting = join(projectRoot, '.demo-tool')
    mkdirSync(preExisting, { recursive: true })

    const transaction = new FileTransaction()
    await installSkill({ transaction, prompt: '# body\n' })
    expect(existsSync(join(preExisting, 'skills', 'planning'))).toBe(true)

    expect(transaction.rollback().kind).toBe('complete')
    expect(existsSync(join(preExisting, 'skills'))).toBe(false)
    expect(existsSync(preExisting)).toBe(true)
  })

  test('an unowned file keeps its directory and is left untouched', async () => {
    const transaction = new FileTransaction()
    await installSkill({ transaction, prompt: '# body\n' })
    const skillDir = dirname(testAdapterSkillPath(projectRoot, 'demo-tool', 'planning'))
    writeFileSync(join(skillDir, 'mine.md'), 'not ours\n')

    expect(transaction.rollback().kind).toBe('complete')
    expect(existsSync(skillDir)).toBe(true)
    expect(read(join(skillDir, 'mine.md'))).toBe('not ours\n')
  })
})

describe('failing plans', () => {
  test('an unsupported filesystem object fails before anything is written', async () => {
    const primary = testAdapterSkillPath(projectRoot, 'demo-tool', 'planning')
    mkdirSync(primary, { recursive: true })

    const transaction = new FileTransaction()
    const result = await installSkill({ transaction, prompt: '# body\n' })

    if (result.ok) expect.unreachable()
    expect(result.failure.kind).toBe('plan-failed')
    expect(transaction.hasMutations()).toBe(false)
  })

  test('an adapter without an asset capability fails loudly rather than silently', async () => {
    const transaction = new FileTransaction()
    const result = await materialize({
      facetName: 'demo',
      manifest: manifestWith({ planning: { prompt: '# body\n' } }),
      projectRoot,
      adapters: [createTestAdapter('metadata-only', { assets: false })],
      newAssets: [skillAsset('planning')],
      previousOwnership: ownership([]),
      transaction,
    })

    if (result.ok) expect.unreachable()
    expect(result.failure.kind).toBe('unsupported-adapter')
  })
})
