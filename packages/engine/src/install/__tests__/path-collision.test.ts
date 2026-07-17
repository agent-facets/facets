import { describe, expect, test } from 'bun:test'
import type { Adapter } from '@agent-facets/adapter'
import type { LockfileAssetEntry } from '@agent-facets/protocol'
import { detectPathCollisions } from '../commit/install-loop.ts'

/**
 * Unit tests for the install-loop path-collision preflight (finding 1). The
 * check refuses two DISTINCT assets that an adapter maps to the same on-disk
 * path — the class of bug that let a Codex skill named `plan` and a command
 * named `plan` clobber each other at `.agents/skills/plan/SKILL.md`.
 */

/**
 * A minimal adapter whose `resolvePath` mirrors Codex's collision surface:
 * skills AND commands both resolve to `skills/<name>/SKILL.md`, while agents
 * live in their own tree. Only the fields the check reads are populated.
 */
function codexLike(name = 'codex'): Adapter {
  return {
    name,
    supportsInstall: true,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
    installAsset: async () => undefined,
    readAsset: async () => ({ content: '' }),
    deleteAsset: async () => undefined,
    resolvePath: (_scope, assetType, assetName) =>
      assetType === 'agent' ? `/root/.codex/agents/${assetName}.toml` : `/root/.agents/skills/${assetName}/SKILL.md`,
  }
}

const asset = (type: LockfileAssetEntry['type'], name: string): LockfileAssetEntry => ({ scope: 'project', type, name })

describe('detectPathCollisions', () => {
  test('flags a skill and command with the same name in one facet', () => {
    const owners = new Map<string, { facet: string; asset: LockfileAssetEntry }>()
    const failure = detectPathCollisions(
      [codexLike()],
      'viper',
      [asset('skill', 'plan'), asset('command', 'plan')],
      owners,
    )

    if (failure === null) expect.unreachable()
    if (failure.code !== 'ASSET_PATH_COLLISION') expect.unreachable()
    expect(failure.adapter).toBe('codex')
    expect(failure.path).toBe('/root/.agents/skills/plan/SKILL.md')
    expect(failure.existing.asset.type).toBe('skill')
    expect(failure.incoming.asset.type).toBe('command')
  })

  test('flags a cross-facet collision (skill in facet A, command in facet B)', () => {
    const owners = new Map<string, { facet: string; asset: LockfileAssetEntry }>()
    const first = detectPathCollisions([codexLike()], 'facet-a', [asset('skill', 'plan')], owners)
    expect(first).toBeNull()

    const second = detectPathCollisions([codexLike()], 'facet-b', [asset('command', 'plan')], owners)
    if (second === null) expect.unreachable()
    if (second.code !== 'ASSET_PATH_COLLISION') expect.unreachable()
    expect(second.existing.facet).toBe('facet-a')
    expect(second.incoming.facet).toBe('facet-b')
  })

  test('does not flag distinct names, or an agent that shares a name with a skill', () => {
    const owners = new Map<string, { facet: string; asset: LockfileAssetEntry }>()
    const failure = detectPathCollisions(
      [codexLike()],
      'viper',
      [asset('skill', 'plan'), asset('command', 'review'), asset('agent', 'plan')],
      owners,
    )
    expect(failure).toBeNull()
  })

  test('the same asset registered twice (idempotent re-check) is not a collision', () => {
    const owners = new Map<string, { facet: string; asset: LockfileAssetEntry }>()
    expect(detectPathCollisions([codexLike()], 'viper', [asset('skill', 'plan')], owners)).toBeNull()
    // Re-running the same facet's same asset must not self-collide.
    expect(detectPathCollisions([codexLike()], 'viper', [asset('skill', 'plan')], owners)).toBeNull()
  })

  test('adapters without resolvePath opt out of the check entirely', () => {
    const bare: Adapter = {
      name: 'claude-code',
      supportsInstall: true,
      buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
      installAsset: async () => undefined,
      readAsset: async () => ({ content: '' }),
      deleteAsset: async () => undefined,
    }
    const owners = new Map<string, { facet: string; asset: LockfileAssetEntry }>()
    // A skill + command named `plan` would collide for codex, but claude-code
    // keeps them in separate trees and doesn't implement resolvePath.
    expect(detectPathCollisions([bare], 'viper', [asset('skill', 'plan'), asset('command', 'plan')], owners)).toBeNull()
  })
})
