import { displayedVersion, type UpdateChoice, type UpdatePlanRow } from '@agent-facets/engine'
import { Box, Text } from 'ink'
import { THEME } from '../../theme.ts'
import { COLUMN_GAP, COLUMN_HEADERS, columnWidth } from './columns.ts'
import { formatExactVersion } from './version-change.ts'

/**
 * What one facet would commit to `facets.json`, when that differs from
 * what it already says.
 *
 * The value comes from the engine's selection validation, never from
 * this file — the preview and the write have to be the same derivation
 * or the preview is fiction.
 */
export interface ManifestRewrite {
  from: string
  to: string
}

export interface UpdatePlanViewProps {
  plan: readonly UpdatePlanRow[]
  /** Which version each selected facet takes. Absent names are not selected. */
  selected: ReadonlyMap<string, UpdateChoice>
  /** Manifest edits the selection would commit, keyed by facet name. */
  rewrites: ReadonlyMap<string, ManifestRewrite>
}

/**
 * The update plan as a table: every checkable facet's declared range,
 * what is installed, and both versions it could move to.
 *
 * Current, Target, and Latest are shown together even when a facet is
 * not selected. That is the point of the screen — "why is this one not
 * moving?" is answered by seeing that its Target equals Current while
 * Latest is ahead, which is exactly the case `--latest` exists for.
 */
export function UpdatePlanView({ plan, selected, rewrites }: UpdatePlanViewProps) {
  const rows = plan.filter((row) => row.kind !== 'unsupported-source')
  const unsupported = plan.filter((row) => row.kind === 'unsupported-source')

  const nameWidth = columnWidth(
    COLUMN_HEADERS.facet,
    rows.map((row) => row.facet.name),
  )
  const sourceWidth = columnWidth(
    COLUMN_HEADERS.declared,
    rows.map((row) => row.facet.authored.source),
  )
  const currentWidth = columnWidth(
    COLUMN_HEADERS.current,
    rows.map((row) => formatExactVersion(row.facet.current)),
  )
  const targetWidth = columnWidth(
    COLUMN_HEADERS.target,
    rows.map((row) => formatExactVersion(displayedVersion(row.facet, 'range'))),
  )

  return (
    <Box flexDirection="column">
      {rows.length > 0 && (
        <Text color={THEME.hint}>
          {'  '}
          {COLUMN_HEADERS.facet.padEnd(nameWidth)}
          {COLUMN_GAP}
          {COLUMN_HEADERS.declared.padEnd(sourceWidth)}
          {COLUMN_GAP}
          {COLUMN_HEADERS.current.padEnd(currentWidth)}
          {COLUMN_GAP}
          {COLUMN_HEADERS.target.padEnd(targetWidth)}
          {COLUMN_GAP}
          {COLUMN_HEADERS.latest}
        </Text>
      )}
      {rows.map((row) => {
        const choice = selected.get(row.facet.name)
        const rewrite = rewrites.get(row.facet.name)
        return (
          <Box key={row.facet.name} flexDirection="column">
            <Text>
              {/* The marker carries the same meaning as the picker's: this
                  row is one of the ones about to move. */}
              <Text color={choice === undefined ? THEME.hint : THEME.success}>
                {choice === undefined ? '  ' : '▸ '}
              </Text>
              <Text bold color={THEME.brand}>
                {row.facet.name.padEnd(nameWidth)}
              </Text>
              {COLUMN_GAP}
              <Text color={THEME.hint}>{row.facet.authored.source.padEnd(sourceWidth)}</Text>
              {COLUMN_GAP}
              <Text>{formatExactVersion(row.facet.current).padEnd(currentWidth)}</Text>
              {COLUMN_GAP}
              <Version
                version={formatExactVersion(displayedVersion(row.facet, 'range'))}
                chosen={choice === 'range'}
                pad={targetWidth}
              />
              {COLUMN_GAP}
              <Version
                version={formatExactVersion(displayedVersion(row.facet, 'latest'))}
                chosen={choice === 'latest'}
              />
            </Text>
            {rewrite !== undefined && (
              <Text color={THEME.caution}>
                {'    '}facets.json {rewrite.from} → {rewrite.to}
              </Text>
            )}
          </Box>
        )
      })}
      {/* Named, never counted as current: a git or local facet was not
          checked at all, and reporting it as up to date would be a claim
          nothing verified. */}
      {unsupported.length > 0 && (
        <Box flexDirection="column" marginTop={rows.length > 0 ? 1 : 0}>
          {unsupported.map((row) => (
            <Text key={row.name} color={THEME.hint}>
              {'  '}
              {row.name} — {row.sourceKind} source ({row.source}); not checked for updates
            </Text>
          ))}
        </Box>
      )}
    </Box>
  )
}

function Version({ version, chosen, pad }: { version: string; chosen: boolean; pad?: number }) {
  const text = pad === undefined ? version : version.padEnd(pad)
  return chosen ? (
    <Text color={THEME.success} bold>
      {text}
    </Text>
  ) : (
    <Text color={THEME.hint}>{text}</Text>
  )
}
