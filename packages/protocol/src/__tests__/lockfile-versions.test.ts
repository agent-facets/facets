import { describe, expect, test } from 'bun:test'
import {
  CURRENT_LOCKFILE_VERSION,
  CurrentLockfileSchema,
  LEGACY_LOCKFILE_VERSION,
  LegacyLockfileSchema,
  parseLockfileDocument,
  SUPPORTED_LOCKFILE_VERSIONS,
} from '@agent-facets/protocol'
import { type } from 'arktype'

const HASH = `sha256:${'b'.repeat(64)}`

const legacyLockfile = {
  lockfileVersion: 1,
  facets: {
    cowsay: {
      source: { kind: 'local', path: '../cowsay' },
      version: '1.0.0',
      integrity: HASH,
      assets: [{ scope: 'project', type: 'skill', name: 'cowsay' }],
    },
  },
}

const currentSkillAsset = {
  scope: 'project',
  type: 'skill',
  name: 'review',
  files: [
    { path: 'skills/review/SKILL.md', integrity: HASH },
    { path: 'skills/review/references/api.md', integrity: HASH },
    { path: 'skills/review/scripts/run.ts', integrity: HASH },
  ],
}

const currentLockfile = {
  lockfileVersion: 0.2,
  facets: {
    cowsay: {
      source: { kind: 'registry', registry: 'https://cafe.example' },
      version: '1.0.0',
      integrity: HASH,
      assets: [
        currentSkillAsset,
        { scope: 'project', type: 'agent', name: 'reviewer', files: [{ path: 'agents/reviewer.md', integrity: HASH }] },
      ],
    },
  },
}

describe('lockfile version constants', () => {
  test('constants are pinned and dispatch is exact, not ordered', () => {
    expect(LEGACY_LOCKFILE_VERSION).toBe(1)
    expect(CURRENT_LOCKFILE_VERSION).toBe(0.2)
    expect(SUPPORTED_LOCKFILE_VERSIONS).toEqual([1, 0.2])
    // 0.2 < 1 numerically — exact-equality dispatch must not treat the
    // current version as "older" than legacy alpha.
    expect(CURRENT_LOCKFILE_VERSION < LEGACY_LOCKFILE_VERSION).toBe(true)
  })
})

describe('LegacyLockfileSchema', () => {
  test('accepts the legacy alpha shape pinned to version 1', () => {
    expect(LegacyLockfileSchema(legacyLockfile)).not.toBeInstanceOf(type.errors)
  })

  test('rejects any other version number', () => {
    expect(LegacyLockfileSchema({ ...legacyLockfile, lockfileVersion: 0.2 })).toBeInstanceOf(type.errors)
    expect(LegacyLockfileSchema({ ...legacyLockfile, lockfileVersion: 2 })).toBeInstanceOf(type.errors)
  })
})

describe('CurrentLockfileSchema', () => {
  test('accepts a 0.2 lockfile with sorted per-file integrity records', () => {
    expect(CurrentLockfileSchema(currentLockfile)).not.toBeInstanceOf(type.errors)
  })

  function withAssets(assets: unknown[]): unknown {
    return {
      lockfileVersion: 0.2,
      facets: {
        cowsay: {
          source: { kind: 'local', path: '../cowsay' },
          version: '1.0.0',
          integrity: HASH,
          assets,
        },
      },
    }
  }

  test('rejects a missing files array', () => {
    expect(CurrentLockfileSchema(withAssets([{ scope: 'project', type: 'agent', name: 'a' }]))).toBeInstanceOf(
      type.errors,
    )
  })

  test('rejects an empty files array', () => {
    expect(
      CurrentLockfileSchema(withAssets([{ scope: 'project', type: 'agent', name: 'a', files: [] }])),
    ).toBeInstanceOf(type.errors)
  })

  test('rejects unsorted file records', () => {
    const unsorted = {
      ...currentSkillAsset,
      files: [
        { path: 'skills/review/scripts/run.ts', integrity: HASH },
        { path: 'skills/review/SKILL.md', integrity: HASH },
      ],
    }
    expect(CurrentLockfileSchema(withAssets([unsorted]))).toBeInstanceOf(type.errors)
  })

  test('rejects duplicate file paths', () => {
    const duplicated = {
      ...currentSkillAsset,
      files: [
        { path: 'skills/review/SKILL.md', integrity: HASH },
        { path: 'skills/review/SKILL.md', integrity: HASH },
      ],
    }
    expect(CurrentLockfileSchema(withAssets([duplicated]))).toBeInstanceOf(type.errors)
  })

  test('rejects traversal in file paths', () => {
    const evil = { ...currentSkillAsset, files: [{ path: '../escape.md', integrity: HASH }] }
    expect(CurrentLockfileSchema(withAssets([evil]))).toBeInstanceOf(type.errors)
  })

  test('rejects malformed integrity values', () => {
    const bad = { ...currentSkillAsset, files: [{ path: 'skills/review/SKILL.md', integrity: 'md5:nope' }] }
    expect(CurrentLockfileSchema(withAssets([bad]))).toBeInstanceOf(type.errors)
  })
})

describe('parseLockfileDocument — exact version dispatch', () => {
  test('parses a legacy alpha 1 document', () => {
    const result = parseLockfileDocument(JSON.stringify(legacyLockfile))
    if (!result.ok) expect.unreachable()
    expect(result.data.lockfileVersion).toBe(1)
  })

  test('parses a current 0.2 document', () => {
    const result = parseLockfileDocument(JSON.stringify(currentLockfile))
    if (!result.ok) expect.unreachable()
    expect(result.data.lockfileVersion).toBe(0.2)
    if (result.data.lockfileVersion !== 0.2) expect.unreachable()
    const asset = result.data.lockfile.facets.cowsay?.assets[0]
    expect(asset?.files[0]?.path).toBe('skills/review/SKILL.md')
  })

  test('legacy shape claiming 0.2 fails as 0.2 — no shape-sniffing', () => {
    const result = parseLockfileDocument(JSON.stringify({ ...legacyLockfile, lockfileVersion: 0.2 }))
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'schema-violation') expect.unreachable()
    expect(result.failure.lockfileVersion).toBe(0.2)
  })

  test('current shape claiming 1 is interpreted only under legacy rules', () => {
    // Legacy tolerates unknown fields (spec: unrecognized keys are allowed),
    // so per-file records ride along as unrecognized extension data — the
    // document is a legacy lockfile, never a current one.
    const result = parseLockfileDocument(JSON.stringify({ ...currentLockfile, lockfileVersion: 1 }))
    if (!result.ok) expect.unreachable()
    expect(result.data.lockfileVersion).toBe(1)
  })

  test('unsupported version is a structured failure', () => {
    const result = parseLockfileDocument(JSON.stringify({ ...legacyLockfile, lockfileVersion: 3 }))
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'unsupported-lockfile-version') expect.unreachable()
    expect(result.failure.observed).toBe(3)
    expect(result.failure.supported).toEqual([1, 0.2])
  })

  test('duplicate JSON members are rejected before schema validation', () => {
    const text = '{"lockfileVersion":1,"lockfileVersion":1,"facets":{}}'
    const result = parseLockfileDocument(text)
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('duplicate-members')
  })

  test('invalid JSON is a structured failure', () => {
    const result = parseLockfileDocument('not json')
    if (result.ok) expect.unreachable()
    expect(result.failure.code).toBe('invalid-json')
  })
})
