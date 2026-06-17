import { describe, expect, test } from 'bun:test'
import { generateScaffoldManifest, type ScaffoldOptions } from '../scaffold/index.ts'

function baseOptions(overrides: Partial<ScaffoldOptions> = {}): ScaffoldOptions {
  return {
    name: 'cowsay',
    version: '0.0.0',
    description: 'Cowsay tools',
    skills: ['cowsay'],
    agents: [],
    commands: [],
    ...overrides,
  }
}

describe('generateScaffoldManifest privacy', () => {
  test('omits `private` when public (option absent)', () => {
    const manifest = JSON.parse(generateScaffoldManifest(baseOptions()))
    expect('private' in manifest).toBe(false)
  })

  test('writes `private: true` when private option is set', () => {
    const manifest = JSON.parse(generateScaffoldManifest(baseOptions({ private: true })))
    expect(manifest.private).toBe(true)
  })

  test('places `private` after description and before asset sections', () => {
    const json = generateScaffoldManifest(baseOptions({ private: true }))
    const keys = Object.keys(JSON.parse(json))
    expect(keys).toEqual(['name', 'version', 'description', 'private', 'skills'])
  })

  test('omits `private` even when description is absent', () => {
    const manifest = JSON.parse(generateScaffoldManifest(baseOptions({ description: '' })))
    expect('private' in manifest).toBe(false)
    const keys = Object.keys(manifest)
    expect(keys).toEqual(['name', 'version', 'skills'])
  })
})
