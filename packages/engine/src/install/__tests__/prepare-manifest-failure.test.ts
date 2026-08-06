import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SUPPORTED_PROJECT_MANIFEST_VERSIONS } from '@agent-facets/protocol'
import { prepareAdd } from '../add/prepare.ts'
import { prepareRemove } from '../remove/prepare.ts'

/**
 * `runInstall` has always reported an unsupported `manifestVersion` as
 * structured data, because the remedy — upgrade the CLI — is not the remedy
 * for a malformed document. Add and remove prepare BEFORE reaching it and
 * flattened every load failure into one prose string, so their users were
 * told to fix or delete a manifest that was not wrong.
 *
 * No registry stubbing and no fixtures: both prepare functions fail on the
 * manifest read before any source is resolved.
 */

let projectRoot: string

function writeManifest(text: string): void {
  writeFileSync(join(projectRoot, 'facets.json'), text)
}

beforeEach(() => {
  projectRoot = realpathSync(mkdtempSync(join(tmpdir(), 'facet-prepare-manifest-')))
})

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true })
})

describe('prepare — unsupported manifestVersion', () => {
  test('add keeps the observed and supported versions', async () => {
    writeManifest(JSON.stringify({ manifestVersion: 0.9, facets: {} }))

    const result = await prepareAdd(projectRoot, [])
    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'manifest-unsupported-version') expect.unreachable()
    expect(result.failure.observed).toBe(0.9)
    expect(result.failure.supported).toEqual(SUPPORTED_PROJECT_MANIFEST_VERSIONS)
    expect(result.failure.path).toBe(join(projectRoot, 'facets.json'))
  })

  test('remove keeps the observed and supported versions', () => {
    writeManifest(JSON.stringify({ manifestVersion: 0.9, facets: {} }))

    const result = prepareRemove({ projectRoot, names: ['anything'] })
    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'manifest-unsupported-version') expect.unreachable()
    expect(result.failure.observed).toBe(0.9)
    expect(result.failure.supported).toEqual(SUPPORTED_PROJECT_MANIFEST_VERSIONS)
    expect(result.failure.path).toBe(join(projectRoot, 'facets.json'))
  })

  // A non-numeric declaration has no observed VERSION to report, only the
  // fact that something unreadable was declared. `undefined` says that;
  // coercing to a number would invent a version the file does not contain.
  test('a non-numeric version reports no observed version', async () => {
    writeManifest(JSON.stringify({ manifestVersion: '0.1', facets: {} }))

    const result = await prepareAdd(projectRoot, [])
    if (result.ok) expect.unreachable()
    if (result.failure.reason !== 'manifest-unsupported-version') expect.unreachable()
    expect(result.failure.observed).toBeUndefined()
  })
})

describe('prepare — failures that really are about the document', () => {
  test.each([
    ['malformed JSON', '{ not json'],
    ['a schema violation', JSON.stringify({ manifestVersion: 0.2, facets: { a: 1 } })],
    ['duplicate members', '{"manifestVersion":0.2,"facets":{"a":"1.*","a":"2.*"}}'],
  ])('add reports %s as a read failure', async (_label, text) => {
    writeManifest(text)

    const result = await prepareAdd(projectRoot, [])
    if (result.ok) expect.unreachable()
    expect(result.failure.reason).toBe('manifest-read')
  })

  test('remove reports a missing manifest as a read failure', () => {
    const result = prepareRemove({ projectRoot, names: ['anything'] })
    if (result.ok) expect.unreachable()
    expect(result.failure.reason).toBe('manifest-read')
  })
})
