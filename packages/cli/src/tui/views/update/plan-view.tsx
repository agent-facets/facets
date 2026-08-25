import type { UpdateChoice, UpdatePlanRow } from '@agent-facets/engine'
import { Box, Text } from 'ink'
import { THEME } from '../../theme.ts'

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

  const nameWidth = width(rows.map((row) => row.facet.name))
  const sourceWidth = width(rows.map((row) => row.facet.authored.source))
  const currentWidth = width(rows.map((row) => describeExact(row.facet.current)))
  const targetWidth = width(rows.map((row) => row.facet.target.metadata.version))

  return (
    <Box flexDirection="column">
      {rows.length > 0 && (
        <Text color={THEME.hint}>
          {'  '}
          {'facet'.padEnd(nameWidth)} {'declared'.padEnd(sourceWidth)} {'current'.padEnd(currentWidth)}{' '}
          {'target'.padEnd(targetWidth)} latest
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
              </Text>{' '}
              <Text color={THEME.hint}>{row.facet.authored.source.padEnd(sourceWidth)}</Text>{' '}
              <Text>{describeExact(row.facet.current).padEnd(currentWidth)}</Text>{' '}
              <Version version={row.facet.target.metadata.version} chosen={choice === 'range'} pad={targetWidth} />{' '}
              <Version version={row.facet.latest.metadata.version} chosen={choice === 'latest'} />
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

function describeExact(version: { major: number; minor: number; patch: number }): string {
  return `${version.major}.${version.minor}.${version.patch}`
}

function width(values: readonly string[]): number {
  return values.reduce((max, value) => Math.max(max, value.length), 0)
}
