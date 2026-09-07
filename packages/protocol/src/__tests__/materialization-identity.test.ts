import { describe, expect, test } from 'bun:test'
import {
  ASSET_DIRECTORY,
  ASSET_TYPE_ORDER,
  adapterKey,
  canonicalPrimaryPath,
  collisionKey,
  compareAssetTypes,
  MATERIALIZATION_NAMESPACE,
  materializationNamespace,
  portableCollisionKey,
  SKILL_PRIMARY_FILE,
  sharesNamespace,
  skillRootPath,
} from '@agent-facets/protocol'

describe('materialization namespaces', () => {
  test('skills and commands share one namespace; agents occupy another', () => {
    expect(MATERIALIZATION_NAMESPACE).toEqual({
      skill: 'skill-command',
      command: 'skill-command',
      agent: 'agent',
    })
    expect(materializationNamespace('skill')).toBe('skill-command')
    expect(materializationNamespace('command')).toBe('skill-command')
    expect(materializationNamespace('agent')).toBe('agent')
  })

  test('sharesNamespace pairs skill with command and is reflexive', () => {
    expect(sharesNamespace('skill', 'command')).toBe(true)
    expect(sharesNamespace('command', 'skill')).toBe(true)
    expect(sharesNamespace('skill', 'skill')).toBe(true)
    expect(sharesNamespace('agent', 'agent')).toBe(true)
  })

  test('agents share a namespace with neither skills nor commands', () => {
    expect(sharesNamespace('agent', 'skill')).toBe(false)
    expect(sharesNamespace('agent', 'command')).toBe(false)
    expect(sharesNamespace('skill', 'agent')).toBe(false)
  })
})

describe('collisionKey — logical uniqueness', () => {
  test('a skill and a command with one name collide', () => {
    expect(collisionKey('project', 'skill', 'deploy')).toBe(collisionKey('project', 'command', 'deploy'))
  })

  test('an agent never collides with a skill or command', () => {
    expect(collisionKey('project', 'agent', 'review')).not.toBe(collisionKey('project', 'skill', 'review'))
    expect(collisionKey('project', 'agent', 'review')).not.toBe(collisionKey('project', 'command', 'review'))
  })

  test('assets in different scopes never collide', () => {
    expect(collisionKey('project', 'skill', 'review')).not.toBe(collisionKey('user', 'skill', 'review'))
    expect(collisionKey('user', 'skill', 'review')).not.toBe(collisionKey('system', 'skill', 'review'))
  })

  test('distinct names in one namespace and scope do not collide', () => {
    expect(collisionKey('project', 'skill', 'review')).not.toBe(collisionKey('project', 'skill', 'deploy'))
  })

  // Portability: names that are distinct byte sequences but resolve to the
  // same file on a case-insensitive or Unicode-normalizing volume MUST be
  // treated as one claim, so neither can silently overwrite the other.
  test('names differing only by case collide', () => {
    expect(collisionKey('project', 'skill', 'Review')).toBe(collisionKey('project', 'skill', 'review'))
  })

  test('Unicode uppercase and lowercase names collide', () => {
    expect(collisionKey('project', 'skill', '\u00c4')).toBe(collisionKey('project', 'skill', '\u00e4'))
  })

  test('full Unicode case folding is not used', () => {
    expect(collisionKey('project', 'skill', '\u00df')).not.toBe(collisionKey('project', 'skill', 'SS'))
  })

  test('names differing only by Unicode normalization collide', () => {
    expect(collisionKey('project', 'skill', 'caf\u00e9')).toBe(collisionKey('project', 'skill', 'cafe\u0301'))
  })

  test('the separator cannot be forged by field concatenation', () => {
    // Without an unambiguous separator, ('project', skill, 'a-b') and a
    // hypothetical scope/name split could spell one key two ways.
    expect(collisionKey('project', 'skill', 'a-b')).not.toBe(collisionKey('project', 'skill', 'a'))
  })
})

describe('adapterKey — concrete addressable identity', () => {
  test('a skill and a command with one name are different files', () => {
    expect(adapterKey('project', 'skill', 'deploy')).not.toBe(adapterKey('project', 'command', 'deploy'))
  })

  test('scope participates in the identity', () => {
    expect(adapterKey('project', 'skill', 'review')).not.toBe(adapterKey('user', 'skill', 'review'))
  })

  // The adapter key addresses what is actually written to disk, so it must
  // NOT case-fold — otherwise two distinguishable on-disk assets would share
  // one ownership record.
  test('case is preserved rather than folded', () => {
    expect(adapterKey('project', 'skill', 'Review')).not.toBe(adapterKey('project', 'skill', 'review'))
  })

  test('equal identities produce equal keys', () => {
    expect(adapterKey('project', 'agent', 'reviewer')).toBe(adapterKey('project', 'agent', 'reviewer'))
  })
})

describe('portableCollisionKey', () => {
  test('folds case and normalizes to NFC', () => {
    expect(portableCollisionKey('Docs/Guide.md')).toBe('docs/guide.md')
    expect(portableCollisionKey('cafe\u0301')).toBe(portableCollisionKey('caf\u00e9'))
  })

  test('leaves an already-canonical lowercase ASCII path unchanged', () => {
    expect(portableCollisionKey('skills/review/SKILL.md'.toLowerCase())).toBe('skills/review/skill.md')
  })
})

describe('canonical authored paths', () => {
  test('each asset type maps to its inner-archive directory', () => {
    expect(ASSET_DIRECTORY).toEqual({ skill: 'skills', agent: 'agents', command: 'commands' })
  })

  test('a skill owns a bundle directory with a reserved primary file', () => {
    expect(skillRootPath('review')).toBe('skills/review/')
    expect(canonicalPrimaryPath('skill', 'review')).toBe('skills/review/SKILL.md')
    expect(SKILL_PRIMARY_FILE).toBe('SKILL.md')
  })

  test('agents and commands are single files', () => {
    expect(canonicalPrimaryPath('agent', 'reviewer')).toBe('agents/reviewer.md')
    expect(canonicalPrimaryPath('command', 'deploy')).toBe('commands/deploy.md')
  })

  test('a companion path is the skill root plus its relative path', () => {
    expect(`${skillRootPath('review')}references/api.md`).toBe('skills/review/references/api.md')
  })
})

describe('asset-type ordering', () => {
  test('sorts skills before agents before commands', () => {
    expect(ASSET_TYPE_ORDER).toEqual({ skill: 0, agent: 1, command: 2 })
    expect(['command', 'skill', 'agent'].sort((a, b) => compareAssetTypes(a as never, b as never))).toEqual([
      'skill',
      'agent',
      'command',
    ])
  })

  test('comparing a type with itself is zero', () => {
    expect(compareAssetTypes('skill', 'skill')).toBe(0)
  })
})
