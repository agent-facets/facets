import { describe, expect, test } from 'bun:test'
import {
  CURRENT_LOCKFILE_VERSION,
  CurrentLockfileSchema,
  LEGACY_LOCKFILE_VERSION,
  LegacyLockfileSchema,
  LOCKFILE_VERSION_0_2,
  LOCKFILE_VERSION_0_3,
  Lockfile02Schema,
  Lockfile03Schema,
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

const skill03Asset = {
  ...currentSkillAsset,
  materialization: { kind: 'authored' },
}

const lockfile03 = {
  lockfileVersion: 0.3,
  facets: {
    cowsay: {
      source: { kind: 'registry', registry: 'https://cafe.example' },
      version: '1.0.0',
      integrity: HASH,
      assets: [{ ...skill03Asset, materialization: { kind: 'aliased', as: 'vendor-review' } }],
    },
  },
}

describe('lockfile version constants', () => {
  test('constants are pinned and every readable version is supported', () => {
    expect(LEGACY_LOCKFILE_VERSION).toBe(1)
    expect(LOCKFILE_VERSION_0_2).toBe(0.2)
    expect(LOCKFILE_VERSION_0_3).toBe(0.3)
    expect(SUPPORTED_LOCKFILE_VERSIONS).toEqual([1, 0.2, 0.3])
  })

  test('dispatch is exact, not ordered', () => {
    // Numerically 0.2 < 0.3 < 1, so any ordered comparison would rank the
    // newest schema as the oldest. Only exact equality is correct.
    expect(LOCKFILE_VERSION_0_2 < LEGACY_LOCKFILE_VERSION).toBe(true)
    expect(LOCKFILE_VERSION_0_3 < LEGACY_LOCKFILE_VERSION).toBe(true)
  })

  // A normal install writes the newest schema. Readers stay broader so
  // earlier documents still load and migrate; that breadth is a property of
  // the format, not a staged writer rollout.
  test('the written version is the newest readable version', () => {
    expect(CURRENT_LOCKFILE_VERSION).toBe(LOCKFILE_VERSION_0_3)
    expect(SUPPORTED_LOCKFILE_VERSIONS).toContain(CURRENT_LOCKFILE_VERSION)
  })

  test('every earlier readable version remains readable', () => {
    expect(SUPPORTED_LOCKFILE_VERSIONS).toContain(LEGACY_LOCKFILE_VERSION)
    expect(SUPPORTED_LOCKFILE_VERSIONS).toContain(LOCKFILE_VERSION_0_2)
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
  test('accepts a 0.3 lockfile with sorted per-file integrity records', () => {
    expect(CurrentLockfileSchema(lockfile03)).not.toBeInstanceOf(type.errors)
  })

  test('rejects the 0.2 shape, which carries no materialization disposition', () => {
    expect(CurrentLockfileSchema(currentLockfile)).toBeInstanceOf(type.errors)
  })

  test('accepts single-file agent and command entries listing exactly their primary path', () => {
    const agent = {
      scope: 'user',
      type: 'agent',
      name: 'reviewer',
      materialization: { kind: 'authored' },
      files: [{ path: 'agents/reviewer.md', integrity: HASH }],
    }
    const command = {
      scope: 'project',
      type: 'command',
      name: 'review',
      materialization: { kind: 'aliased', as: 'audit' },
      files: [{ path: 'commands/review.md', integrity: HASH }],
    }
    expect(CurrentLockfileSchema(withAssets([agent, command]))).not.toBeInstanceOf(type.errors)
  })

  function withAssets(assets: unknown[]): unknown {
    return {
      lockfileVersion: 0.3,
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
    expect(result.failure.supported).toEqual([1, 0.2, 0.3])
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

  test('parses a 0.3 document and exposes its dispositions', () => {
    const result = parseLockfileDocument(JSON.stringify(lockfile03))
    if (!result.ok) expect.unreachable()
    if (result.data.lockfileVersion !== LOCKFILE_VERSION_0_3) expect.unreachable()
    const asset = result.data.lockfile.facets.cowsay?.assets[0]
    expect(asset?.materialization).toEqual({ kind: 'aliased', as: 'vendor-review' })
  })

  // The no-fallback guarantee, in every direction between adjacent versions.
  test('a malformed 0.3 document fails as 0.3 and is never retried as 0.2', () => {
    // A valid 0.2 asset claiming 0.3: it has no disposition, which 0.3
    // requires. It must fail AS 0.3 rather than silently reading as 0.2.
    const result = parseLockfileDocument(JSON.stringify({ ...currentLockfile, lockfileVersion: 0.3 }))
    if (result.ok) expect.unreachable()
    if (result.failure.code !== 'schema-violation') expect.unreachable()
    expect(result.failure.lockfileVersion).toBe(LOCKFILE_VERSION_0_3)
  })

  test('a 0.3 shape claiming 0.2 is read only under 0.2 rules', () => {
    // 0.2 tolerates unrecognized keys, so the dispositions ride along as
    // extension data — the document is a 0.2 lockfile, never a 0.3 one.
    const result = parseLockfileDocument(JSON.stringify({ ...lockfile03, lockfileVersion: 0.2 }))
    if (!result.ok) expect.unreachable()
    expect(result.data.lockfileVersion).toBe(LOCKFILE_VERSION_0_2)
  })

  test('a 0.3 shape claiming 1 is read only under legacy rules', () => {
    const result = parseLockfileDocument(JSON.stringify({ ...lockfile03, lockfileVersion: 1 }))
    if (!result.ok) expect.unreachable()
    expect(result.data.lockfileVersion).toBe(LEGACY_LOCKFILE_VERSION)
  })
})

describe('Lockfile03Schema', () => {
  function with03Assets(assets: unknown[]): unknown {
    return {
      lockfileVersion: LOCKFILE_VERSION_0_3,
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

  test('accepts each disposition arm', () => {
    for (const materialization of [
      { kind: 'authored' },
      { kind: 'aliased', as: 'vendor-review' },
      { kind: 'omitted' },
    ]) {
      expect(Lockfile03Schema(with03Assets([{ ...skill03Asset, materialization }]))).not.toBeInstanceOf(type.errors)
    }
  })

  test('rejects an asset entry with no materialization disposition', () => {
    const { materialization: _omitted, ...withoutDisposition } = skill03Asset
    expect(Lockfile03Schema(with03Assets([withoutDisposition]))).toBeInstanceOf(type.errors)
  })

  test('rejects an invalid alias in a disposition', () => {
    const bad = { ...skill03Asset, materialization: { kind: 'aliased', as: 'Vendor-Review' } }
    expect(Lockfile03Schema(with03Assets([bad]))).toBeInstanceOf(type.errors)
  })

  test('rejects a non-0.3 version', () => {
    expect(Lockfile03Schema({ ...lockfile03, lockfileVersion: 0.2 })).toBeInstanceOf(type.errors)
  })

  // An aliased asset's `name` and `files` stay AUTHORED — those identities
  // anchor integrity, so aliasing must not perturb them.
  test('an aliased asset keeps its authored name and canonical authored paths', () => {
    const aliased = { ...skill03Asset, materialization: { kind: 'aliased', as: 'vendor-review' } }
    const result = Lockfile03Schema(with03Assets([aliased]))
    if (result instanceof type.errors) expect.unreachable()
    const asset = result.facets.cowsay?.assets[0]
    expect(asset?.name).toBe('review')
    expect(asset?.files.map((f) => f.path)).toEqual([
      'skills/review/SKILL.md',
      'skills/review/references/api.md',
      'skills/review/scripts/run.ts',
    ])
  })

  // The lockfile records the resolved asset SET so it can be compared
  // against project intent; only the receipt drops what is not on disk.
  test('an omitted asset remains listed with all authored file records', () => {
    const omitted = {
      scope: 'project',
      type: 'command',
      name: 'deploy',
      materialization: { kind: 'omitted' },
      files: [{ path: 'commands/deploy.md', integrity: HASH }],
    }
    const result = Lockfile03Schema(with03Assets([omitted]))
    if (result instanceof type.errors) expect.unreachable()
    expect(result.facets.cowsay?.assets[0]?.files[0]?.path).toBe('commands/deploy.md')
  })

  // The file-record rules are factored out and shared with 0.2, so these
  // pin that the extraction did not drop any of them.
  test('the shared file-record rules still apply', () => {
    const empty = { ...skill03Asset, files: [] }
    expect(Lockfile03Schema(with03Assets([empty]))).toBeInstanceOf(type.errors)

    const unsorted = {
      ...skill03Asset,
      files: [
        { path: 'skills/review/scripts/run.ts', integrity: HASH },
        { path: 'skills/review/SKILL.md', integrity: HASH },
      ],
    }
    expect(Lockfile03Schema(with03Assets([unsorted]))).toBeInstanceOf(type.errors)

    const duplicated = {
      ...skill03Asset,
      files: [
        { path: 'skills/review/SKILL.md', integrity: HASH },
        { path: 'skills/review/SKILL.md', integrity: HASH },
      ],
    }
    expect(Lockfile03Schema(with03Assets([duplicated]))).toBeInstanceOf(type.errors)

    const traversal = { ...skill03Asset, files: [{ path: 'skills/review/../../escape.md', integrity: HASH }] }
    expect(Lockfile03Schema(with03Assets([traversal]))).toBeInstanceOf(type.errors)

    const badHash = { ...skill03Asset, files: [{ path: 'skills/review/SKILL.md', integrity: 'md5:nope' }] }
    expect(Lockfile03Schema(with03Assets([badHash]))).toBeInstanceOf(type.errors)
  })

  test('0.2 and 0.3 reject each other by version pin', () => {
    expect(Lockfile02Schema(lockfile03)).toBeInstanceOf(type.errors)
    expect(Lockfile03Schema(currentLockfile)).toBeInstanceOf(type.errors)
  })
})
