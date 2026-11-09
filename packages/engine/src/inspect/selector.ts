import type { FacetManifest } from '@agent-facets/protocol'

export type InspectAssetType = 'skill' | 'command' | 'agent'

/** The manifest itself, or a file it declares. Nothing outside this set is ever read. */
export type DeclaredFile =
  | { kind: 'manifest'; path: 'facet.json' }
  | { kind: 'primary'; path: string; type: InspectAssetType; name: string }
  | { kind: 'companion'; path: string; skill: string }
  | { kind: 'supplementary'; path: string }

export type SelectorResolution =
  | { kind: 'file'; file: DeclaredFile }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'server-only' }
  | { kind: 'not-found'; printable: string[] }

const FOLDER: Record<InspectAssetType, string> = { skill: 'skills', command: 'commands', agent: 'agents' }
const FOLDER_PREFIXED = /^(skills|commands|agents)\/([^/]+)$/

/** The file that defines an asset: `skills/<name>/SKILL.md`, or `<folder>/<name>.md` for a command or agent. */
export function primaryPath(type: InspectAssetType, name: string): string {
  return type === 'skill' ? `skills/${name}/SKILL.md` : `${FOLDER[type]}/${name}.md`
}

/**
 * The manifest and every file it declares, in display order: `facet.json`,
 * each skill followed by its companions, then commands, agents, and
 * top-level files. The manifest is listed so what `facet info` summarizes
 * can always be checked against the raw document.
 */
export function declaredFiles(manifest: FacetManifest): DeclaredFile[] {
  const files: DeclaredFile[] = [{ kind: 'manifest', path: 'facet.json' }]
  for (const [name, skill] of Object.entries(manifest.skills ?? {})) {
    files.push({ kind: 'primary', path: primaryPath('skill', name), type: 'skill', name })
    for (const companion of skill.files ?? []) {
      files.push({ kind: 'companion', path: `skills/${name}/${companion}`, skill: name })
    }
  }
  for (const name of Object.keys(manifest.commands ?? {})) {
    files.push({ kind: 'primary', path: primaryPath('command', name), type: 'command', name })
  }
  for (const name of Object.keys(manifest.agents ?? {})) {
    files.push({ kind: 'primary', path: primaryPath('agent', name), type: 'agent', name })
  }
  for (const path of manifest.files ?? []) {
    files.push({ kind: 'supplementary', path })
  }
  return files
}

/**
 * Resolve a `facet cat` selector against the declared files only.
 *
 * Forms, tried in order: an exact declared path; `skills/<n>`,
 * `commands/<n>`, or `agents/<n>`; a bare asset name. Asset names are a
 * single segment with no `/` or `.`, so the forms cannot overlap. A bare
 * name can match at most one skill-or-command (they share a namespace)
 * and one agent.
 */
export function resolveSelector(manifest: FacetManifest, selector: string): SelectorResolution {
  const files = declaredFiles(manifest)

  const exact = files.find((file) => file.path === selector)
  if (exact !== undefined) return { kind: 'file', file: exact }

  const prefixed = FOLDER_PREFIXED.exec(selector)
  if (prefixed !== null) {
    const type = typeForFolder(prefixed[1])
    const match = files.find((file) => file.kind === 'primary' && file.type === type && file.name === prefixed[2])
    if (match !== undefined) return { kind: 'file', file: match }
    return { kind: 'not-found', printable: printableSelectors(manifest) }
  }

  if (!selector.includes('/')) {
    const matches = files.filter(
      (file): file is Extract<DeclaredFile, { kind: 'primary' }> => file.kind === 'primary' && file.name === selector,
    )
    const [only] = matches
    if (matches.length === 1 && only !== undefined) return { kind: 'file', file: only }
    if (matches.length > 1) return { kind: 'ambiguous', candidates: matches.map((m) => `${FOLDER[m.type]}/${m.name}`) }
    if (Object.hasOwn(manifest.servers ?? {}, selector)) return { kind: 'server-only' }
  }

  return { kind: 'not-found', printable: printableSelectors(manifest) }
}

/**
 * The shortest selector that prints this file: the bare name unless an
 * agent shares it with a skill or command, otherwise the folder-prefixed
 * form; the declared path for every other file.
 */
export function selectorFor(manifest: FacetManifest, file: DeclaredFile): string {
  if (file.kind !== 'primary') return file.path
  const shared =
    file.type === 'agent'
      ? Object.hasOwn(manifest.skills ?? {}, file.name) || Object.hasOwn(manifest.commands ?? {}, file.name)
      : Object.hasOwn(manifest.agents ?? {}, file.name)
  return shared ? `${FOLDER[file.type]}/${file.name}` : file.name
}

function printableSelectors(manifest: FacetManifest): string[] {
  return declaredFiles(manifest).map((file) => selectorFor(manifest, file))
}

function typeForFolder(folder: string | undefined): InspectAssetType {
  if (folder === 'skills') return 'skill'
  if (folder === 'commands') return 'command'
  return 'agent'
}
