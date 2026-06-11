import type { WireAssetCounts, WirePackageListItem } from '@agent-facets/engine'
import { Box, Text, useApp } from 'ink'
import { useCallback, useEffect, useRef, useState } from 'react'
import { ASSET_TYPE_COLORS, THEME } from '../../theme.ts'

/** Dot animation cycle: '', '.', '..', '...' */
const DOT_CYCLE = ['', '.', '..', '...']
const DOT_INTERVAL_MS = 350

export type SearchResult = { ok: true; facets: ReadonlyArray<WirePackageListItem> } | { ok: false; error: 'handled' }

export interface SearchViewProps {
  term: string | undefined
  /** Async function that fetches from the registry. Errors are handled
   *  by the caller (writeCliError to stderr) before returning ok:false. */
  fetch: () => Promise<SearchResult>
  /** Called with the exit code when the view is done. */
  onComplete?: (code: number) => void
}

/**
 * Search view with an animated "Searching registry for '<term>'" line
 * while the fetch is in progress, then transitions to results or
 * "found no matches."
 */
export function SearchView({ term, fetch, onComplete }: SearchViewProps) {
  const { exit } = useApp()
  const [dotIndex, setDotIndex] = useState(0)
  const [result, setResult] = useState<SearchResult | null>(null)
  const startedRef = useRef(false)

  // Animate the dots while loading.
  useEffect(() => {
    if (result !== null) return
    const interval = setInterval(() => {
      setDotIndex((prev) => (prev + 1) % DOT_CYCLE.length)
    }, DOT_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [result])

  // Run the fetch once on mount.
  const start = useCallback(async () => {
    if (startedRef.current) return
    startedRef.current = true
    const r = await fetch()
    setResult(r)
    if (!r.ok) {
      onComplete?.(1)
      exit(new Error('search failed'))
    }
  }, [fetch, onComplete, exit])

  useEffect(() => {
    void start()
  }, [start])

  const termLabel = term !== undefined ? ` for '${term}'` : ''

  // Still loading — animated dots.
  if (result === null) {
    return (
      <Text color={THEME.hint}>
        Searching registry{termLabel}
        {DOT_CYCLE[dotIndex]}
      </Text>
    )
  }

  // Fetch failed — error already written to stderr by the command.
  if (!result.ok) {
    return null
  }

  const all = result.facets
  const filtered = term !== undefined ? all.filter((f) => f.name.toLowerCase().includes(term.toLowerCase())) : all

  // No results at all.
  if (filtered.length === 0) {
    return (
      <SearchDone
        term={term}
        count={0}
        onExit={() => {
          onComplete?.(0)
          exit()
        }}
      />
    )
  }

  // Results found.
  const nameWidth = filtered.reduce((max, f) => Math.max(max, f.name.length), 0)
  const versionWidth = filtered.reduce((max, f) => Math.max(max, `v${f.latest_version}`.length), 0)
  const authorWidth = filtered.reduce((max, f) => Math.max(max, `by ${f.author ?? f.publisher ?? ''}`.length), 0)

  return (
    <SearchDone
      term={term}
      count={filtered.length}
      onExit={() => {
        onComplete?.(0)
        exit()
      }}
    >
      {filtered.map((f) => (
        <SearchResultRow
          key={f.name}
          item={f}
          nameWidth={nameWidth}
          versionWidth={versionWidth}
          authorWidth={authorWidth}
        />
      ))}
    </SearchDone>
  )
}

/** Wrapper that shows the "Searching registry...found N" header and exits after paint. */
function SearchDone({
  term,
  count,
  onExit,
  children,
}: {
  term: string | undefined
  count: number
  onExit: () => void
  children?: React.ReactNode
}) {
  useEffect(() => {
    onExit()
  }, [onExit])

  const termLabel = term !== undefined ? ` for '${term}'` : ''
  const countLabel = count === 0 ? 'found no matches.' : `found ${count} match${count === 1 ? '' : 'es'}.`

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={THEME.hint}>Searching registry{termLabel}...</Text>
        <Text color={count > 0 ? THEME.success : THEME.warning}>{countLabel}</Text>
      </Text>
      {children}
    </Box>
  )
}

function SearchResultRow({
  item,
  nameWidth,
  versionWidth,
  authorWidth,
}: {
  item: WirePackageListItem
  nameWidth: number
  versionWidth: number
  authorWidth: number
}) {
  const version = `v${item.latest_version}`
  const counts = formatColoredAssetCounts(item.asset_counts)

  return (
    <Text>
      {'  '}
      <Text bold color={THEME.brand}>
        {item.name.padEnd(nameWidth)}
      </Text>
      {'  '}
      <Text color={THEME.hint}>{version.padEnd(versionWidth)}</Text> <Text color={THEME.hint}>·</Text>{' '}
      <Text>
        <Text color={THEME.hint}>by </Text>
        <Text>{(item.author ?? item.publisher ?? '').padEnd(authorWidth - 3)}</Text>
      </Text>{' '}
      <Text color={THEME.hint}>·</Text> {counts}
    </Text>
  )
}

function formatColoredAssetCounts(counts: WireAssetCounts): React.ReactNode {
  const KINDS: ReadonlyArray<{
    key: keyof WireAssetCounts
    singular: string
    plural: string
    color: string
  }> = [
    { key: 'skills', singular: 'skill', plural: 'skills', color: ASSET_TYPE_COLORS.skill },
    { key: 'agents', singular: 'agent', plural: 'agents', color: ASSET_TYPE_COLORS.agent },
    { key: 'commands', singular: 'command', plural: 'commands', color: ASSET_TYPE_COLORS.command },
    { key: 'servers', singular: 'server', plural: 'servers', color: ASSET_TYPE_COLORS.server },
  ]

  const parts: React.ReactNode[] = []
  for (const { key, singular, plural, color } of KINDS) {
    const n = counts[key]
    if (n > 0) {
      if (parts.length > 0)
        parts.push(
          <Text key={`sep-${key}`} color={THEME.hint}>
            ,{' '}
          </Text>,
        )
      parts.push(
        <Text key={key} color={color}>
          {n} {n === 1 ? singular : plural}
        </Text>,
      )
    }
  }

  return <>{parts}</>
}
