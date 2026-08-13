import { describe, expect, test } from 'bun:test'
import type { UnsupportedManifestVersion } from '@agent-facets/engine'
import { addPrepareCliError } from '../../commands/add/index.ts'
import { removePrepareCliError } from '../../commands/remove/index.ts'
import { installFailureFix } from '../../commands/shared/install-failure.ts'
import {
  describeUnsupportedManifestVersion,
  UNSUPPORTED_MANIFEST_VERSION_FIX,
  UNSUPPORTED_MANIFEST_VERSION_WHAT,
  unsupportedManifestVersionError,
} from '../unsupported-manifest-version.ts'

/**
 * One condition, four front doors, two surfaces. The wording used to be
 * retyped at each one — including two structurally identical copies of the
 * detail type inside this package — and had already drifted into three
 * phrasings of the same remedy.
 */

const detail: UnsupportedManifestVersion = {
  path: '/tmp/p/facets.json',
  observed: 0.9,
  supported: [0.1],
}

describe('unsupported manifestVersion wording', () => {
  test('names what was found and what this CLI understands', () => {
    const described = describeUnsupportedManifestVersion(detail)
    expect(described).toContain('0.9')
    expect(described).toContain('0.1')
    expect(described).toContain('unversioned')
  })

  test('a non-numeric version is described rather than invented', () => {
    expect(describeUnsupportedManifestVersion({ ...detail, observed: undefined })).toContain('non-numeric')
  })

  test('the stderr error carries the path and the shared what/fix', () => {
    const error = unsupportedManifestVersionError(detail)
    expect(error.what).toBe(UNSUPPORTED_MANIFEST_VERSION_WHAT)
    expect(error.fix).toBe(UNSUPPORTED_MANIFEST_VERSION_FIX)
    expect(error.detail).toContain(detail.path)
  })

  // The regression this module exists to prevent: `add` and `remove` told the
  // user to fix or delete a manifest that was not wrong, and `list` printed
  // engine's sentence while everything else printed the CLI's.
  test('every front door emits the identical remedy', () => {
    const fixes = [
      addPrepareCliError({ reason: 'manifest-unsupported-version', ...detail }).fix,
      removePrepareCliError({ reason: 'manifest-unsupported-version', ...detail }).fix,
      unsupportedManifestVersionError(detail).fix,
      installFailureFix(
        { code: 'FACETS_JSON_UNSUPPORTED_VERSION', ...detail },
        { kind: 'not-needed', reason: 'post-lock-no-mutation' },
        'install',
      ),
    ]
    expect(new Set(fixes)).toEqual(new Set([UNSUPPORTED_MANIFEST_VERSION_FIX]))
  })
})
