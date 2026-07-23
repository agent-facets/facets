/**
 * One-off generator for the immutable archive fixtures:
 *
 *   - `valid-0.1.facet` — a valid legacy archive as the pre-`0.2` producer
 *     emitted it (asset-only, `assets` hash map).
 *   - `valid-0.2.facet` — a valid current archive with a skill companion,
 *     a binary supplementary file, an empty supplementary file, and a root
 *     `README.md` (`files` hash map, `facetVersion: 0.2`).
 *
 * Run from `packages/protocol`:
 *
 *   bun src/__tests__/fixtures/generate.ts
 *
 * These fixtures are IMMUTABLE compatibility anchors: they pin that future
 * consumers keep accepting today's bytes. Do NOT regenerate them when
 * verification code changes — a change that rejects these bytes is a
 * breaking format change and needs its own reviewed migration. (The only
 * legitimate reason to regenerate is creating a NEW fixture for a NEW
 * format version alongside the existing ones.)
 */
import { join } from 'node:path'
import { buildCurrentArchive, buildLegacyArchive } from '../archive-helpers.ts'

const dir = import.meta.dir

const legacy = buildLegacyArchive({
  name: 'fixture-legacy',
  version: '1.0.0',
  description: 'Immutable legacy 0.1 fixture',
  skills: {
    'code-review': { description: 'Review code', prompt: '# Code Review\n\nReview the diff.' },
  },
  agents: {
    helper: { description: 'A helper', prompt: '# Helper\n\nAssist the user.' },
  },
  commands: {
    ship: { description: 'Ship it', prompt: '# Ship\n\nShip the change.' },
  },
})
await Bun.write(join(dir, 'valid-0.1.facet'), legacy.outerBytes)

const currentManifest = JSON.stringify(
  {
    name: 'fixture-current',
    version: '1.0.0',
    description: 'Immutable current 0.2 fixture',
    skills: {
      review: {
        description: 'Review code',
        files: ['references/api.md', 'assets/logo.bin', 'notes/empty.txt'],
      },
    },
    agents: { helper: { description: 'A helper' } },
    files: ['README.md', 'LICENSE'],
  },
  null,
  2,
)
const current = buildCurrentArchive({
  'facet.json': currentManifest,
  'skills/review/SKILL.md': '# Review\n\nReview the diff.',
  'skills/review/references/api.md': '# API reference\n',
  'skills/review/assets/logo.bin': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff, 0xfe]),
  'skills/review/notes/empty.txt': new Uint8Array(0),
  'agents/helper.md': '# Helper\n\nAssist the user.',
  'README.md': '# fixture-current\n\nImmutable current-format fixture.\n',
  LICENSE: 'MIT\n',
})
await Bun.write(join(dir, 'valid-0.2.facet'), current.outerBytes)

console.log('wrote valid-0.1.facet and valid-0.2.facet')
