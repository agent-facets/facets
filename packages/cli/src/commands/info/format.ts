import type { FacetView, InspectAssetType } from '@agent-facets/engine'
import { declaredFiles, selectorFor } from '@agent-facets/engine'
import type { MaterializationDisposition } from '@agent-facets/protocol'
import { safeText, shellQuote } from '../../util/terminal-safe.ts'
import { identitySegments, type VerifiedOwner } from './identity.ts'

export type Style = 'title' | 'action-label' | 'label' | 'dim' | 'hint'
export interface Segment {
  text: string
  style?: Style
}
export type Line = Segment[]

export interface FormatInfoInput {
  view: Pick<FacetView, 'name' | 'version' | 'manifest' | 'origin' | 'disposition'>
  identity?: { owner: VerifiedOwner; publisher: string }
  /** Byte sizes of declared non-primary files known to be binary. */
  binarySizes: ReadonlyMap<string, number>
  webUrl?: string
}

const MIN_WIDTH = 40
const MIN_DESCRIPTION_WIDTH = 20
const INDENT = '  '
const GAP = '   '
/** Wrapped description lines sit deeper than hints, so description text can never fill a hint's position. */
const CONTINUATION = '  '

/** The `facet info` summary as styled lines, wrapped to `width` columns. */
export function formatInfo(input: FormatInfoInput, width: number): Line[] {
  const columns = Math.max(width, MIN_WIDTH)
  const { view } = input
  const manifest = view.manifest
  const installed = view.origin.kind === 'installed'
  const lines: Line[] = []

  lines.push([
    { text: view.name, style: 'title' },
    {
      text: `  ${[`v${view.version}`, ...identitySegments(manifest.author, input.identity)].join(' · ')}`,
    },
  ])
  lines.push(...sourceLines(view.origin))

  lines.push(
    [],
    installed
      ? [
          { text: 'Check for updates:', style: 'action-label' },
          { text: ' facet outdated', style: 'hint' },
        ]
      : [{ text: 'INSTALL:', style: 'action-label' }, { text: ` facet add ${shellQuote(view.name)}` }],
  )

  if (manifest.description !== undefined && manifest.description.length > 0) {
    lines.push([])
    for (const row of wrap(oneLine(manifest.description), columns - INDENT.length))
      lines.push([{ text: `${INDENT}${row}` }])
  }

  const rows = assetRows(input)
  const nameWidth = Math.max(0, ...rows.flatMap((group) => group.rows.map((row) => row.name.length))) + GAP.length
  const statusWidth = Math.max(0, ...rows.flatMap((group) => group.rows.map((row) => row.status?.length ?? 0)))
  const statusColumn = statusWidth > 0 ? statusWidth + 2 : 0
  const descriptionWidth = Math.max(MIN_DESCRIPTION_WIDTH, columns - INDENT.length - nameWidth - statusColumn)
  const under = ' '.repeat(INDENT.length + nameWidth)

  for (const group of rows) {
    if (group.rows.length === 0) continue
    lines.push([])
    lines.push([{ text: `${group.title} (${group.rows.length})`, style: 'label' }])
    for (const row of group.rows) {
      const text =
        row.literal !== undefined
          ? packTokens(row.literal, descriptionWidth, descriptionWidth - CONTINUATION.length)
          : wrap(row.description, descriptionWidth, descriptionWidth - CONTINUATION.length)
      const first: Line = [{ text: `${INDENT}${row.name.padEnd(nameWidth)}` }, { text: text[0] ?? '' }]
      if (row.status !== undefined) {
        first.push({
          text: `${' '.repeat(Math.max(2, descriptionWidth - (text[0] ?? '').length + 2))}${row.status}`,
          style: 'dim',
        })
      }
      lines.push(first)
      for (const more of text.slice(1)) lines.push([{ text: `${under}${CONTINUATION}${more}` }])
      for (const detail of row.details) lines.push([{ text: `${under}${detail.text}`, style: detail.style }])
    }
  }

  const files = declaredFiles(manifest).filter((file) => file.kind === 'manifest' || file.kind === 'supplementary')
  if (files.length > 0) {
    lines.push([])
    lines.push([{ text: `Files (${files.length})`, style: 'label' }])
    for (const file of files) {
      const action = actionFor(input, file.path, selectorFor(manifest, file))
      if (safeText(file.path).length < nameWidth) {
        lines.push([{ text: `${INDENT}${safeText(file.path).padEnd(nameWidth)}` }, action])
      } else {
        lines.push([{ text: `${INDENT}${safeText(file.path)}` }], [{ text: under }, action])
      }
    }
  }

  if (input.webUrl !== undefined) {
    lines.push([], [{ text: 'WEB:', style: 'label' }, { text: ` ${input.webUrl}` }])
  }

  return lines.map((line) => line.map((segment) => ({ ...segment, text: safeText(segment.text) })))
}

/** Where the summary was read from, so a registry read is never mistaken for the installed copy. */
function sourceLines(origin: FormatInfoInput['view']['origin']): Line[] {
  return [
    [
      {
        text:
          origin.from === 'local-path'
            ? 'Installed · read from its local source directory'
            : 'Installed · read from your local copy',
        style: 'dim',
      },
    ],
  ]
}

/**
 * A copy-pasteable `facet cat` command; arguments are shell-quoted, then made
 * terminal-safe. A selector that starts with `-` goes after `--`, or the
 * CLI would read it as a flag.
 */
function catHint(name: string, selector: string): string {
  const separator = selector.startsWith('-') ? '-- ' : ''
  return safeText(`facet cat ${shellQuote(name)} ${separator}${shellQuote(selector)}`)
}

/** Plain text for a non-terminal: styles dropped, trailing spaces trimmed. */
export function plainText(lines: Line[]): string {
  return `${lines
    .map((line) =>
      line
        .map((segment) => segment.text)
        .join('')
        .trimEnd(),
    )
    .join('\n')}\n`
}

interface Row {
  name: string
  description: string
  /** Tokens shown verbatim (a server's URL or command line): lines break only between them, never inside one. */
  literal?: string[]
  status?: string
  details: Segment[]
}

function assetRows(input: FormatInfoInput): Array<{ title: string; rows: Row[] }> {
  const { view } = input
  const manifest = view.manifest
  const installed = view.origin.kind === 'installed'
  const files = declaredFiles(manifest)

  const textAssets = (type: InspectAssetType, entries: Record<string, { description: string }> | undefined): Row[] =>
    Object.entries(entries ?? {}).map(([name, asset]) => {
      const primary = files.find((file) => file.kind === 'primary' && file.type === type && file.name === name)
      const details: Segment[] =
        primary === undefined ? [] : [{ text: catHint(view.name, selectorFor(manifest, primary)), style: 'hint' }]
      if (type === 'skill') {
        for (const companion of files) {
          if (companion.kind !== 'companion' || companion.skill !== name) continue
          const action = actionFor(input, companion.path, companion.path)
          details.push({
            text: `+ ${action.style === 'hint' ? action.text : `${safeText(companion.path)} (${action.text})`}`,
            style: 'hint',
          })
        }
      }
      return {
        name,
        description: oneLine(asset.description),
        ...statusFor(installed ? view.disposition(type, name) : undefined),
        details,
      }
    })

  const servers: Row[] = Object.entries(manifest.servers ?? {}).map(([name, server]) => {
    const details: Segment[] = []
    let literal: string[]
    if (server.type === 'http') {
      literal = ['http', '·', displayUrl(server.url)]
    } else {
      literal = ['stdio', '·', ...[server.command, ...(server.args ?? [])].map((part) => strictText(shellQuote(part)))]
      for (const [variable, value] of Object.entries(server.env ?? {})) {
        details.push({ text: `env: ${strictText(`${variable}=${shellQuote(value)}`)}`, style: 'dim' })
      }
    }
    return {
      name,
      description: literal.join(' '),
      literal,
      ...statusFor(installed ? view.disposition('server', name) : undefined),
      details,
    }
  })

  return [
    { title: 'Skills', rows: textAssets('skill', manifest.skills) },
    { title: 'Commands', rows: textAssets('command', manifest.commands) },
    { title: 'Agents', rows: textAssets('agent', manifest.agents) },
    { title: 'MCP servers', rows: servers },
  ]
}

function statusFor(disposition: MaterializationDisposition | undefined): { status?: string } {
  if (disposition === undefined || disposition.kind === 'authored') return {}
  return disposition.kind === 'aliased' ? { status: `installed as ${safeText(disposition.as)}` } : { status: 'omitted' }
}

function actionFor(input: FormatInfoInput, path: string, selector: string): Segment {
  const size = input.binarySizes.get(path)
  if (size !== undefined) return { text: `binary, ${formatBytes(size)}`, style: 'dim' }
  return { text: catHint(input.view.name, selector), style: 'hint' }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Publisher text for a one-line field: runs of whitespace, including line breaks, become one space. */
function oneLine(text: string): string {
  return safeText(text.replace(/\s+/g, ' ').trim())
}

/** `safeText`, with line feeds and tabs escaped too, for values whose exact characters matter. */
function strictText(text: string): string {
  return safeText(text.replaceAll('\n', '^J').replaceAll('\t', '^I'))
}

/** A URL as the client will resolve it: a look-alike Unicode host is shown in its punycode form. */
function displayUrl(url: string): string {
  try {
    return strictText(new URL(url).href)
  } catch {
    return strictText(url)
  }
}

/**
 * Word-wrap prose: the first row at `width`, later rows at `laterWidth`
 * (narrower, for a hanging indent). Words longer than a row are split.
 */
export function wrap(text: string, width: number, laterWidth: number = width): string[] {
  const rows: string[] = []
  const limit = (): number => (rows.length === 0 ? width : laterWidth)
  for (const paragraph of text.split('\n')) {
    let current = ''
    for (const word of paragraph.split(/\s+/).filter((w) => w.length > 0)) {
      let rest = word
      while (rest.length > limit() || (current.length > 0 && current.length + 1 + rest.length > limit())) {
        if (current.length > 0) {
          rows.push(current)
          current = ''
          continue
        }
        const at = limit()
        rows.push(rest.slice(0, at))
        rest = rest.slice(at)
      }
      current = current.length === 0 ? rest : `${current} ${rest}`
    }
    rows.push(current)
  }
  while (rows.length > 1 && rows.at(-1) === '') rows.pop()
  return rows
}

/**
 * Lay out tokens that must be copied exactly: single spaces between them,
 * line breaks only between tokens, and a token wider than a line kept whole
 * on its own line rather than split.
 */
export function packTokens(tokens: string[], width: number, laterWidth: number = width): string[] {
  const rows: string[] = []
  let current = ''
  for (const token of tokens) {
    const limit = rows.length === 0 ? width : laterWidth
    if (current.length > 0 && current.length + 1 + token.length > limit) {
      rows.push(current)
      current = token
    } else {
      current = current.length === 0 ? token : `${current} ${token}`
    }
  }
  rows.push(current)
  return rows
}
