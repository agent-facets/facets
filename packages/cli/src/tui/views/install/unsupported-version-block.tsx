import type { UnsupportedManifestVersion } from '@agent-facets/engine'
import { Box, Text } from 'ink'
import type React from 'react'
import {
  describeUnsupportedManifestVersion,
  UNSUPPORTED_MANIFEST_VERSION_FIX,
  UNSUPPORTED_MANIFEST_VERSION_WHAT,
} from '../../../util/unsupported-manifest-version.ts'
import { THEME } from '../../theme.ts'

/**
 * One rendering of "this CLI is too old to read your manifest", shared by
 * install, add, and remove.
 *
 * Layout and colour only. Every word comes from the shared module, so this
 * block and the stderr error cannot disagree about what happened or what to
 * do about it.
 */
export function UnsupportedManifestVersionBlock({ detail }: { detail: UnsupportedManifestVersion }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text color={THEME.warning} bold>
        ✕ {UNSUPPORTED_MANIFEST_VERSION_WHAT}
      </Text>
      <Text color={THEME.hint}> {detail.path}</Text>
      <Text> {describeUnsupportedManifestVersion(detail)}</Text>
      <Text color={THEME.hint}> {UNSUPPORTED_MANIFEST_VERSION_FIX}</Text>
    </Box>
  )
}
