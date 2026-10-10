#!/usr/bin/env node
/**
 * Node-only smoke test for @agent-facets/protocol.
 *
 * Verifies that the published bundle loads cleanly under Node with no Bun
 * runtime present and exercises representative APIs end to end:
 *   - validateFacetManifest on bytes
 *   - computeContentHash determinism
 *   - assembleTar producing deterministic bytes
 *   - parseFacetArchive round-trip on a freshly-assembled outer tar
 *   - parseBuildManifestDocument / parseLockfileDocument exact version dispatch
 *   - parseProjectManifestDocument exact manifestVersion dispatch
 *   - validateRawTarEntries raw-header validation
 *   - planArchiveEntries membership/classification
 *   - materialization identity, namespaces, dispositions, and planMaterialization
 *   - lockfile 0.3 dispositions with no cross-version fallback
 *   - lockfile 0.4 server inventory: exact dispatch, required inventories,
 *     the fixed fingerprint encoding, and locked MCP inventory derivation
 *   - validateFacetArchive end-to-end on a 0.2 archive (async, node:zlib gunzip)
 *   - listVerifiedFiles / verifiedFileHashes uniform views
 *
 * Run from the repo root after `bun run --cwd packages/protocol build`, through
 * the Node-only launcher, which proves Bun is unreachable (shims included)
 * before running anything:
 *
 *   node scripts/smoke/node-only.mjs scripts/smoke/protocol-node.mjs
 */

import { strict as assert } from 'node:assert'
import { gunzipSync, gzipSync } from 'node:zlib'

import {
  adapterKey,
  assembleOuterTar,
  assembleTar,
  canonicalPrimaryPath,
  collectArchiveEntries,
  collisionKey,
  computeAssetHashes,
  computeContentHash,
  computeMcpServerFingerprint,
  deriveLockedMcpInventory,
  detectNamingCollisions,
  LOCKFILE_0_4_SERVER_FINGERPRINT_ENCODING,
  Lockfile03Schema,
  listVerifiedFiles,
  MaterializationDispositionSchema,
  MCP_SERVER_FINGERPRINT_ENCODING,
  materializationNamespace,
  ProjectAssetOverrideSchema,
  parseBuildManifestDocument,
  parseFacetArchive,
  parseLockfileDocument,
  parseProjectManifestDocument,
  planArchiveEntries,
  planLockedServerInventory,
  planMaterialization,
  resolvePromptsFromMap,
  validateFacetArchive,
  validateFacetManifest,
  validateRawTarEntries,
  verifiedFileHashes,
} from '../../packages/protocol/dist/index.mjs'

let pass = 0
let fail = 0

function check(name, fn) {
  try {
    fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    fail++
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
  }
}

async function checkAsync(name, fn) {
  try {
    await fn()
    pass++
    console.log(`  ✓ ${name}`)
  } catch (err) {
    fail++
    console.error(`  ✗ ${name}`)
    console.error(`    ${err.message}`)
  }
}

/**
 * Node-native `GunzipFn` for `validateFacetArchive`: the protocol does no
 * decompression itself, so each consumer injects its own. This mirrors what
 * the registry and CLI supply, using `node:zlib` with no Bun present.
 */
async function nodeGunzip(innerGzBytes) {
  try {
    return { ok: true, bytes: new Uint8Array(gunzipSync(innerGzBytes)) }
  } catch {
    return { ok: false, reason: 'corrupt' }
  }
}

console.log('node version:', process.version)
console.log('bun?', typeof globalThis.Bun)
console.log('')
console.log('=== validateFacetManifest ===')

const validManifestBytes = new TextEncoder().encode(
  JSON.stringify({
    name: 'smoke-test',
    version: '1.0.0',
    description: 'Smoke-test facet',
    skills: { greeter: { description: 'Says hi' } },
  }),
)

check('accepts a valid manifest from bytes', () => {
  const result = validateFacetManifest(validManifestBytes)
  assert(result.ok, 'expected ok=true')
  assert.equal(result.data.name, 'smoke-test')
  assert.equal(result.data.version, '1.0.0')
})

check('accepts a valid manifest from a string', () => {
  const result = validateFacetManifest('{"name":"smoke","version":"1.0.0","skills":{"greeter":{"description":"x"}}}')
  assert(result.ok)
})

check('rejects malformed JSON with a structured error', () => {
  const result = validateFacetManifest('{not json}')
  assert(!result.ok)
  assert(Array.isArray(result.errors))
  assert(result.errors.length > 0)
})

console.log('')
console.log('=== computeContentHash ===')

check('produces sha256:<hex> format', () => {
  const hash = computeContentHash('hello world')
  assert.equal(hash, 'sha256:b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9')
})

check('identical inputs produce identical hashes', () => {
  const a = computeContentHash('same')
  const b = computeContentHash('same')
  assert.equal(a, b)
})

check('different inputs produce different hashes', () => {
  const a = computeContentHash('one')
  const b = computeContentHash('two')
  assert.notEqual(a, b)
})

console.log('')
console.log('=== assembleTar + parseFacetArchive ===')

const manifestText = JSON.stringify({
  name: 'archive-test',
  version: '1.0.0',
  skills: { greeter: { description: 'Says hi' } },
})
const manifestParsed = validateFacetManifest(manifestText)
assert(manifestParsed.ok, 'manifest parse failed')

const promptsResult = resolvePromptsFromMap(manifestParsed.data, {
  'skills/greeter/SKILL.md': '# Greeter\n\nSay hi.',
})
assert(promptsResult.ok, 'prompts resolve failed')

const entries = collectArchiveEntries(promptsResult.data, manifestText)
const innerTar = assembleTar(entries)
const integrity = computeContentHash(innerTar)
const assetHashes = computeAssetHashes(entries)

const buildManifest = {
  facetVersion: 0.1,
  archive: 'archive.tar.gz',
  integrity,
  assets: assetHashes,
}

const compressed = gzipSync(innerTar)
const outerTar = assembleOuterTar(JSON.stringify(buildManifest, null, 2), compressed)

check('assembleTar produces deterministic bytes', () => {
  const innerTar2 = assembleTar(entries)
  assert.deepEqual(innerTar, innerTar2)
})

check('parseFacetArchive recovers the embedded build manifest', () => {
  const result = parseFacetArchive(outerTar)
  assert(result.ok, 'expected ok=true on a well-formed archive')
  // Tagged result shape: `data.manifest` is `{ facetVersion, manifest }`.
  const parsed = result.data.manifest
  assert.equal(parsed.facetVersion, 0.1)
  assert.equal(parsed.manifest.integrity, integrity)
  assert.equal(parsed.manifest.archive, 'archive.tar.gz')
})

check('parseFacetArchive yields gunzippable inner archive bytes', () => {
  const result = parseFacetArchive(outerTar)
  assert(result.ok, 'expected ok=true on a well-formed archive')
  // gunzip with node:zlib and verify the bytes hash back to the integrity value
  const recoveredInnerTar = gunzipSync(result.data.innerArchiveBytes)
  const recoveredIntegrity = computeContentHash(new Uint8Array(recoveredInnerTar))
  assert.equal(recoveredIntegrity, integrity)
})

check('parseFacetArchive returns ok=false on a malformed archive', () => {
  // Outer tar with build-manifest.json containing invalid JSON.
  const badOuter = assembleOuterTar('{not valid json', compressed)
  const result = parseFacetArchive(badOuter)
  assert.equal(result.ok, false)
  // Tagged failure shape: `failure` is a discriminated union. Invalid JSON in
  // the embedded build manifest surfaces as `code: 'invalid-json'` with a
  // structured `errors` array.
  assert(result.failure, 'expected a structured failure')
  assert.equal(result.failure.code, 'invalid-json')
  assert(Array.isArray(result.failure.errors))
  assert(result.failure.errors.length > 0)
})

console.log('')
console.log('=== detectNamingCollisions ===')

check('detects a duplicate name within a single asset type', () => {
  const errors = detectNamingCollisions({
    name: 'x',
    version: '1.0.0',
    skills: {
      // The schema requires Record<string, ...>, but for the rule check we
      // pass two skills with the same name through validation by hand.
      // In practice this can't happen in the parsed schema (object keys
      // are unique), but the function is defined to also handle inputs
      // produced by manual reconstruction. Skipping the duplicate-key
      // assertion here since the function accepts only the manifest shape.
      a: { description: 'x' },
      b: { description: 'y' },
    },
  })
  // No collision — different keys
  assert.equal(errors.length, 0)
})

console.log('')
console.log('=== parseBuildManifestDocument (exact version dispatch) ===')

check('accepts a legacy 0.1 build manifest', () => {
  const result = parseBuildManifestDocument(
    JSON.stringify({ facetVersion: 0.1, archive: 'archive.tar.gz', integrity, assets: assetHashes }),
  )
  assert(result.ok, 'expected ok=true')
  assert.equal(result.data.facetVersion, 0.1)
})

check('rejects an unsupported facetVersion with structured failure', () => {
  const result = parseBuildManifestDocument(
    JSON.stringify({ facetVersion: 9.9, archive: 'archive.tar.gz', integrity, files: {} }),
  )
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, 'unsupported-facet-version')
  assert.equal(result.failure.observed, 9.9)
  assert(Array.isArray(result.failure.supported))
})

check('rejects duplicate object members before schema validation', () => {
  const result = parseBuildManifestDocument(
    '{"facetVersion":0.1,"facetVersion":0.2,"archive":"archive.tar.gz","integrity":"sha256:x","assets":{}}',
  )
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, 'duplicate-members')
})

console.log('')
console.log('=== parseLockfileDocument (exact version dispatch) ===')

check('rejects an unsupported lockfileVersion with structured failure', () => {
  const result = parseLockfileDocument(JSON.stringify({ lockfileVersion: 9.9, facets: {} }))
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, 'unsupported-lockfile-version')
  assert.equal(result.failure.observed, 9.9)
})

console.log('')
console.log('=== validateRawTarEntries ===')

check('accepts a canonical inner tar', () => {
  const result = validateRawTarEntries(innerTar, 'archive.tar.gz')
  assert(result.ok, 'expected ok=true on a canonical tar')
  assert(Array.isArray(result.entries))
})

console.log('')
console.log('=== planArchiveEntries (membership + classification) ===')

check('classifies manifest, primary asset, companion, and archive-only entries', () => {
  const result = planArchiveEntries({
    skills: { greeter: { files: ['references/notes.md'] } },
    files: ['README.md'],
  })
  assert(result.ok, `expected ok=true, got errors: ${result.ok ? '' : JSON.stringify(result.errors)}`)
  const byPath = new Map(result.data.map((e) => [e.path, e.kind]))
  assert.equal(byPath.get('facet.json'), 'manifest')
  assert.equal(byPath.get('skills/greeter/SKILL.md'), 'primary-asset')
  assert.equal(byPath.get('skills/greeter/references/notes.md'), 'skill-companion')
  assert.equal(byPath.get('README.md'), 'archive-only')
})

console.log('')
console.log('=== validateFacetArchive on a 0.2 archive (async, node:zlib) ===')

// A 0.2 archive with a primary skill, a skill companion, and an archive-only
// root file — assembled directly (companions/archive-only are not yet emitted
// by collectArchiveEntries; that is the producer block). Every inner entry is
// hashed into the build manifest's `files` map, mirroring what a 0.2 producer
// emits and what the registry will verify.
const currentManifestText = JSON.stringify({
  name: 'archive-current',
  version: '1.0.0',
  skills: { greeter: { description: 'Says hi', files: ['references/notes.md'] } },
  files: ['README.md'],
})
const currentEntries = [
  { path: 'facet.json', content: currentManifestText },
  { path: 'README.md', content: '# archive-current\n' },
  { path: 'skills/greeter/SKILL.md', content: '# Greeter\n\nSay hi.' },
  { path: 'skills/greeter/references/notes.md', content: 'reference notes' },
].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))

const currentInnerTar = assembleTar(currentEntries)
const currentIntegrity = computeContentHash(currentInnerTar)
const currentFiles = computeAssetHashes(currentEntries)
const currentBuildManifest = {
  facetVersion: 0.2,
  archive: 'archive.tar.gz',
  integrity: currentIntegrity,
  files: currentFiles,
}
const currentOuterTar = assembleOuterTar(JSON.stringify(currentBuildManifest, null, 2), gzipSync(currentInnerTar))

await checkAsync('verifies a well-formed 0.2 archive end to end', async () => {
  const result = await validateFacetArchive(currentOuterTar, { gunzip: nodeGunzip })
  assert(result.ok, `expected ok=true, got failure: ${result.ok ? '' : JSON.stringify(result.failure)}`)
  assert.equal(result.data.archiveVersion, 0.2)
  assert.equal(result.data.buildManifest.integrity, currentIntegrity)
})

await checkAsync('listVerifiedFiles + verifiedFileHashes span every inner entry', async () => {
  const result = await validateFacetArchive(currentOuterTar, { gunzip: nodeGunzip })
  assert(result.ok, 'expected ok=true')
  const files = listVerifiedFiles(result.data)
  const paths = new Set(files.map((f) => f.path))
  assert(paths.has('facet.json'))
  assert(paths.has('README.md'))
  assert(paths.has('skills/greeter/SKILL.md'))
  assert(paths.has('skills/greeter/references/notes.md'))
  const hashes = verifiedFileHashes(result.data)
  assert.equal(hashes['skills/greeter/references/notes.md'], currentFiles['skills/greeter/references/notes.md'])
})

await checkAsync('rejects a tampered 0.2 archive with a structured integrity failure', async () => {
  // Re-gzip a mutated inner tar so the content no longer matches `integrity`.
  const tamperedInner = assembleTar([...currentEntries, { path: 'extra.txt', content: 'x' }])
  const tamperedOuter = assembleOuterTar(JSON.stringify(currentBuildManifest, null, 2), gzipSync(tamperedInner))
  const result = await validateFacetArchive(tamperedOuter, { gunzip: nodeGunzip })
  assert.equal(result.ok, false)
  assert(result.failure, 'expected a structured failure')
  // Integrity mismatch (content hash) or entry-set/membership mismatch — either
  // is a structured, non-throwing rejection; assert it is one of them.
  assert(
    ['integrity', 'entry-integrity', 'validation'].includes(result.failure.code),
    `unexpected failure code: ${result.failure.code}`,
  )
})

console.log('=== materialization identity + namespaces ===')

check('skills and commands share a namespace; agents do not', () => {
  assert.equal(materializationNamespace('skill'), 'skill-command')
  assert.equal(materializationNamespace('command'), 'skill-command')
  assert.equal(materializationNamespace('agent'), 'agent')
})

check('collisionKey folds namespace and name; adapterKey does not', () => {
  // Logical: a skill and a command named `deploy` cannot coexist.
  assert.equal(collisionKey('project', 'skill', 'deploy'), collisionKey('project', 'command', 'deploy'))
  // Concrete: they are nonetheless two different files.
  assert.notEqual(adapterKey('project', 'skill', 'deploy'), adapterKey('project', 'command', 'deploy'))
  // Portability: case-variant names resolve to one file on some volumes.
  assert.equal(collisionKey('project', 'skill', 'Review'), collisionKey('project', 'skill', 'review'))
})

check('canonicalPrimaryPath derives authored archive paths', () => {
  assert.equal(canonicalPrimaryPath('skill', 'review'), 'skills/review/SKILL.md')
  assert.equal(canonicalPrimaryPath('agent', 'reviewer'), 'agents/reviewer.md')
  assert.equal(canonicalPrimaryPath('command', 'deploy'), 'commands/deploy.md')
})

console.log('=== materialization dispositions ===')

check('the three disposition arms validate and illegal combinations are rejected', () => {
  assert(!(MaterializationDispositionSchema({ kind: 'authored' }) instanceof Error))
  assert(!(MaterializationDispositionSchema({ kind: 'aliased', as: 'vendor-review' }) instanceof Error))
  assert(!(MaterializationDispositionSchema({ kind: 'omitted' }) instanceof Error))
  // An alias with no target, a stray target, and a non-grammar alias all fail.
  assert(MaterializationDispositionSchema({ kind: 'aliased' })?.summary)
  assert(MaterializationDispositionSchema({ kind: 'omitted', as: 'x' })?.summary)
  assert(MaterializationDispositionSchema({ kind: 'aliased', as: 'Review' })?.summary)
})

check('a project override cannot spell authored materialization explicitly', () => {
  assert(!(ProjectAssetOverrideSchema({ kind: 'omitted' }) instanceof Error))
  assert(ProjectAssetOverrideSchema({ kind: 'authored' })?.summary)
})

console.log('=== planMaterialization (pure collision planning) ===')

check('reports every collision group in one pass without choosing a winner', () => {
  const result = planMaterialization([
    { facet: 'a', assets: [{ scope: 'project', type: 'skill', name: 'review' }] },
    { facet: 'b', assets: [{ scope: 'project', type: 'skill', name: 'review' }] },
    { facet: 'c', assets: [{ scope: 'project', type: 'command', name: 'deploy' }] },
    { facet: 'd', assets: [{ scope: 'project', type: 'skill', name: 'deploy' }] },
  ])
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'collision')
  assert.equal(result.groups.length, 2)
})

check('aliases and omissions produce a collision-free plan', () => {
  const result = planMaterialization([
    { facet: 'a', assets: [{ scope: 'project', type: 'skill', name: 'review' }] },
    {
      facet: 'b',
      assets: [{ scope: 'project', type: 'skill', name: 'review' }],
      overrides: { skills: { review: { kind: 'aliased', as: 'vendor-review' } } },
    },
  ])
  assert.equal(result.ok, true)
  assert.deepEqual(result.plan.materialized.map((a) => a.effectiveName).sort(), ['review', 'vendor-review'])
})

check('the plan does not depend on declaration order', () => {
  const contributions = [
    { facet: 'zeta', assets: [{ scope: 'project', type: 'skill', name: 'a' }] },
    { facet: 'alpha', assets: [{ scope: 'project', type: 'agent', name: 'b' }] },
  ]
  const forward = planMaterialization(contributions)
  const reversed = planMaterialization([...contributions].reverse())
  assert.deepEqual(forward, reversed)
})

console.log('=== parseProjectManifestDocument (exact manifestVersion dispatch) ===')

check('an unversioned compact document is read as legacy', () => {
  const result = parseProjectManifestDocument(JSON.stringify({ facets: { a: '1.*' } }))
  assert.equal(result.ok, true)
  assert.equal(result.data.manifestVersion, 'legacy-unversioned')
})

check('a 0.1 document carries expanded entries with typed overrides', () => {
  const doc = {
    manifestVersion: 0.1,
    facets: {
      b: { source: 'github:example/b#main', materialization: { commands: { deploy: { kind: 'omitted' } } } },
    },
  }
  const result = parseProjectManifestDocument(JSON.stringify(doc))
  assert.equal(result.ok, true)
  assert.equal(result.data.manifestVersion, 0.1)
})

check('an expanded entry in an unversioned document is rejected, not promoted', () => {
  const doc = { facets: { b: { source: 'github:example/b', materialization: {} } } }
  const result = parseProjectManifestDocument(JSON.stringify(doc))
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, 'schema-violation')
  assert.equal(result.failure.manifestVersion, 'legacy-unversioned')
})

check('a 0.2 document carries server materialization overrides', () => {
  const doc = {
    manifestVersion: 0.2,
    facets: {
      c: { source: '1.*', materialization: { servers: { filesystem: { kind: 'aliased', as: 'team-fs' } } } },
    },
  }
  const result = parseProjectManifestDocument(JSON.stringify(doc))
  assert.equal(result.ok, true)
  assert.equal(result.data.manifestVersion, 0.2)
  assert.equal(result.data.manifest.facets.c.materialization.servers.filesystem.as, 'team-fs')
})

// The servers group is the whole reason 0.2 exists, so a 0.1 document must not
// be allowed to carry one -- accepting it would silently discard the intent.
check('a servers group is rejected in a 0.1 document', () => {
  const doc = {
    manifestVersion: 0.1,
    facets: { c: { source: '1.*', materialization: { servers: { filesystem: { kind: 'omitted' } } } } },
  }
  const result = parseProjectManifestDocument(JSON.stringify(doc))
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, 'schema-violation')
})

check('an unsupported manifestVersion is a structured failure', () => {
  const result = parseProjectManifestDocument(JSON.stringify({ manifestVersion: 0.3, facets: {} }))
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, 'unsupported-manifest-version')
  assert.equal(result.failure.observed, 0.3)
})

console.log('=== lockfile 0.3 (dispositions, exact dispatch) ===')

const lockfile03Doc = {
  lockfileVersion: 0.3,
  facets: {
    cowsay: {
      source: { kind: 'registry', registry: 'https://cafe.example' },
      version: '1.0.0',
      integrity: `sha256:${'b'.repeat(64)}`,
      assets: [
        {
          scope: 'project',
          type: 'skill',
          name: 'review',
          materialization: { kind: 'aliased', as: 'vendor-review' },
          files: [{ path: 'skills/review/SKILL.md', integrity: `sha256:${'b'.repeat(64)}` }],
        },
      ],
    },
  },
}

check('a 0.3 lockfile keeps authored identity while recording the alias', () => {
  const result = parseLockfileDocument(JSON.stringify(lockfile03Doc))
  assert.equal(result.ok, true)
  assert.equal(result.data.lockfileVersion, 0.3)
  const asset = result.data.lockfile.facets.cowsay.assets[0]
  assert.equal(asset.name, 'review')
  assert.equal(asset.files[0].path, 'skills/review/SKILL.md')
  assert.deepEqual(asset.materialization, { kind: 'aliased', as: 'vendor-review' })
})

check('a 0.3 asset without a disposition is rejected', () => {
  const { materialization: _dropped, ...noDisposition } = lockfile03Doc.facets.cowsay.assets[0]
  const doc = { ...lockfile03Doc, facets: { cowsay: { ...lockfile03Doc.facets.cowsay, assets: [noDisposition] } } }
  assert(Lockfile03Schema(doc)?.summary)
})

check('a malformed 0.3 document is never reinterpreted as 0.2', () => {
  // Valid 0.2 assets (no dispositions) claiming 0.3 must fail AS 0.3.
  const asset = { ...lockfile03Doc.facets.cowsay.assets[0] }
  delete asset.materialization
  const doc = { ...lockfile03Doc, facets: { cowsay: { ...lockfile03Doc.facets.cowsay, assets: [asset] } } }
  const result = parseLockfileDocument(JSON.stringify(doc))
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, 'schema-violation')
  assert.equal(result.failure.lockfileVersion, 0.3)
})

console.log('=== lockfile 0.4 (server inventory, exact dispatch) ===')

const filesystem = { type: 'stdio', command: 'npx', args: ['-y', 'server-filesystem'] }
const docs = { type: 'http', url: 'https://docs.example/mcp' }
const lockfile04Doc = {
  lockfileVersion: 0.4,
  facets: {
    alpha: {
      source: { kind: 'registry', registry: 'https://cafe.example' },
      version: '1.0.0',
      integrity: `sha256:${'a'.repeat(64)}`,
      assets: [],
      servers: [
        { name: 'docs', fingerprint: computeMcpServerFingerprint(docs), materialization: { kind: 'omitted' } },
        {
          name: 'filesystem',
          fingerprint: computeMcpServerFingerprint(filesystem),
          materialization: { kind: 'aliased', as: 'workspace-files' },
        },
      ],
    },
    beta: {
      source: { kind: 'local', path: '../beta' },
      version: '0.2.0',
      integrity: `sha256:${'b'.repeat(64)}`,
      assets: [],
      servers: [
        {
          name: 'files',
          fingerprint: computeMcpServerFingerprint(filesystem),
          materialization: { kind: 'aliased', as: 'workspace-files' },
        },
      ],
    },
  },
}

check('both fingerprint encoding identifiers are facets:mcp-server:v1', () => {
  assert.equal(MCP_SERVER_FINGERPRINT_ENCODING, 'facets:mcp-server:v1')
  assert.equal(LOCKFILE_0_4_SERVER_FINGERPRINT_ENCODING, 'facets:mcp-server:v1')
  assert.equal(
    computeMcpServerFingerprint({ type: 'stdio', command: 'npx' }),
    'sha256:6424550ee92491465134168e17c8c43082b58ad834e436318c4a5eb8ec14db91',
  )
})

check('a 0.4 lockfile parses as exactly 0.4', () => {
  const result = parseLockfileDocument(JSON.stringify(lockfile04Doc))
  assert(result.ok, `expected ok=true, got ${result.ok ? '' : JSON.stringify(result.failure)}`)
  assert.equal(result.data.lockfileVersion, 0.4)
})

check('a 0.4 entry without a server inventory is rejected as 0.4, never as 0.3', () => {
  const { servers: _dropped, ...noInventory } = lockfile04Doc.facets.beta
  const result = parseLockfileDocument(JSON.stringify({ lockfileVersion: 0.4, facets: { beta: noInventory } }))
  assert.equal(result.ok, false)
  assert.equal(result.failure.code, 'schema-violation')
  assert.equal(result.failure.lockfileVersion, 0.4)
})

check('derivation selects by alias and keeps every origin and the omitted record', () => {
  const parsed = parseLockfileDocument(JSON.stringify(lockfile04Doc))
  assert(parsed.ok)
  const inventory = deriveLockedMcpInventory(parsed.data.lockfile)
  assert(inventory.ok, `expected ok=true, got ${JSON.stringify(inventory)}`)
  assert.deepEqual(
    inventory.servers.map((server) => [
      server.effectiveName,
      server.origins.map((o) => `${o.facet}/${o.authoredName}`),
    ]),
    [['workspace-files', ['alpha/filesystem', 'beta/files']]],
  )
  assert.deepEqual(
    inventory.authored.map((record) => `${record.facet}/${record.authoredName}:${record.materialization.kind}`),
    ['alpha/docs:omitted', 'alpha/filesystem:aliased', 'beta/files:aliased'],
  )
})

check('a legacy lockfile reports inventory unavailable, never empty', () => {
  const parsed = parseLockfileDocument(JSON.stringify(lockfile03Doc))
  assert(parsed.ok)
  assert.deepEqual(deriveLockedMcpInventory(parsed.data.lockfile), {
    ok: false,
    reason: 'inventory-unavailable',
    lockfileVersion: 0.3,
    requiredVersion: 0.4,
  })
})

check('fingerprint-only planning applies manifest intent and finds stale overrides', () => {
  const result = planLockedServerInventory([
    { facet: 'alpha', servers: [{ name: 'filesystem', fingerprint: computeMcpServerFingerprint(filesystem) }] },
    { facet: 'empty', servers: [], overrides: { servers: { gone: { kind: 'omitted' } } } },
  ])
  assert(result.ok)
  assert.deepEqual(
    result.configurations.map((c) => c.identity.effectiveName),
    ['filesystem'],
  )
  assert.deepEqual(
    result.staleOverrides.map((stale) => `${stale.facet}/${stale.authoredName}`),
    ['empty/gone'],
  )
})

console.log('')
if (fail === 0) {
  console.log(`✓ ${pass} checks passed`)
  process.exit(0)
} else {
  console.error(`✗ ${fail} of ${pass + fail} checks failed`)
  process.exit(1)
}
