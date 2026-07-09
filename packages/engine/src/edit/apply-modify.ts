import type { FacetManifest } from '@agent-facets/protocol'
import { validateFacetManifest } from '@agent-facets/protocol'
import type { AssetManifestKey } from './scanner.ts'

/**
 * The asset target of a modify operation. Mirrors the singular CLI target
 * (`skill`/`agent`/`command`) mapped to its plural manifest section key.
 */
export type AssetTarget = AssetManifestKey

/**
 * A single field-level mutation applied to an asset descriptor. Adapter
 * mutations carry the adapter name as part of the node so there is no
 * separate "which adapter?" field that could disagree with the config —
 * name and payload travel together.
 */
export type FieldMutation =
  | { field: 'description'; value: string }
  | { field: 'adapter'; adapter: string; config: Record<string, unknown> }
  | { field: 'remove-adapter'; adapter: string }

/**
 * A fully-validated modify operation. This tagged union is the ONLY shape
 * `applyModify` accepts — the CLI's `parseModifyArgs` is responsible for
 * rejecting every illegal flag combination before constructing one of these.
 *
 * Note `remove` carries no `mutations` field at all: modifying fields while
 * removing an asset is not merely rejected at runtime, it is unrepresentable.
 */
export type ModifyOp =
  | { kind: 'add'; target: AssetTarget; name: string; mutations: FieldMutation[] }
  | { kind: 'rename'; target: AssetTarget; name: string; to: string; mutations: FieldMutation[] }
  | { kind: 'update'; target: AssetTarget; name: string; mutations: FieldMutation[] }
  | { kind: 'remove'; target: AssetTarget; name: string }
  | { kind: 'set-facet-meta'; fields: FacetMetaFields }

/** Facet-level metadata mutation. At least one field is set (enforced by the parser). */
export interface FacetMetaFields {
  name?: string
  description?: string
  version?: string
  /** `true` sets `private: true`; `false` removes the key (public-by-default). */
  private?: boolean
}

/**
 * A filesystem side effect the caller must perform after the manifest is
 * written. Pure `applyModify` computes these but never touches disk.
 */
export type ModifyFileOp =
  | { op: 'scaffold'; target: AssetTarget; name: string }
  | { op: 'delete'; target: AssetTarget; name: string }
  | { op: 'move'; target: AssetTarget; from: string; to: string }

export type ApplyModifyResult =
  | { ok: true; manifest: FacetManifest; fileOps: ModifyFileOp[]; summary: string[] }
  | { ok: false; error: ApplyModifyError }

/** Structured, pure-data failure describing why a modify operation was rejected. */
export type ApplyModifyError =
  | { reason: 'asset-exists'; target: AssetTarget; name: string }
  | { reason: 'asset-not-found'; target: AssetTarget; name: string }
  | { reason: 'rename-target-exists'; target: AssetTarget; name: string }
  | { reason: 'adapter-not-found'; target: AssetTarget; name: string; adapter: string }
  | { reason: 'no-such-facet-field' }
  | { reason: 'manifest-invalid'; messages: string[] }

/**
 * A mutation-level failure that doesn't yet know its enclosing asset. The
 * `applyMutations` helper operates on a lone descriptor, so it reports the
 * adapter that was missing; `applyModify` — which does know the target/name —
 * completes it into a full `ApplyModifyError`.
 */
type MutationError = { reason: 'adapter-not-found'; adapter: string }

interface AssetDescriptor {
  description: string
  adapters?: Record<string, unknown>
  [key: string]: unknown
}

/**
 * Apply a validated modify operation to a manifest, purely. Returns the new
 * manifest, the filesystem operations the caller must perform, and a
 * human-readable summary of what changed — or a structured error.
 *
 * The result manifest is re-validated with protocol's bytes-validator before
 * being returned, so a mutation that would produce an invalid `facet.json`
 * fails here and the caller writes nothing.
 */
export function applyModify(manifest: FacetManifest, op: ModifyOp): ApplyModifyResult {
  // Work on a deep clone so the input is never mutated.
  const next = structuredClone(manifest) as FacetManifest
  const summary: string[] = []
  const fileOps: ModifyFileOp[] = []

  switch (op.kind) {
    case 'add': {
      const section = ensureSection(next, op.target)
      if (section[op.name] !== undefined) {
        return { ok: false, error: { reason: 'asset-exists', target: op.target, name: op.name } }
      }
      const descriptor: AssetDescriptor = { description: '' }
      const applied = applyMutations(descriptor, op.mutations)
      if (!applied.ok) return { ok: false, error: completeMutationError(applied.error, op.target, op.name) }
      section[op.name] = descriptor
      fileOps.push({ op: 'scaffold', target: op.target, name: op.name })
      summary.push(`added ${singular(op.target)} "${op.name}"`)
      break
    }

    case 'update': {
      const section = getSection(next, op.target)
      const descriptor = section?.[op.name] as AssetDescriptor | undefined
      if (!descriptor) {
        return { ok: false, error: { reason: 'asset-not-found', target: op.target, name: op.name } }
      }
      const applied = applyMutations(descriptor, op.mutations)
      if (!applied.ok) return { ok: false, error: completeMutationError(applied.error, op.target, op.name) }
      summary.push(...applied.summary.map((s) => `${s} on ${singular(op.target)} "${op.name}"`))
      break
    }

    case 'rename': {
      const section = getSection(next, op.target)
      const descriptor = section?.[op.name] as AssetDescriptor | undefined
      if (!section || !descriptor) {
        return { ok: false, error: { reason: 'asset-not-found', target: op.target, name: op.name } }
      }
      if (section[op.to] !== undefined) {
        return { ok: false, error: { reason: 'rename-target-exists', target: op.target, name: op.to } }
      }
      const applied = applyMutations(descriptor, op.mutations)
      if (!applied.ok) return { ok: false, error: completeMutationError(applied.error, op.target, op.name) }
      delete section[op.name]
      section[op.to] = descriptor
      fileOps.push({
        op: 'move',
        target: op.target,
        from: assetPath(op.target, op.name),
        to: assetPath(op.target, op.to),
      })
      summary.push(`renamed ${singular(op.target)} "${op.name}" → "${op.to}"`)
      break
    }

    case 'remove': {
      const section = getSection(next, op.target)
      if (!section || section[op.name] === undefined) {
        return { ok: false, error: { reason: 'asset-not-found', target: op.target, name: op.name } }
      }
      delete section[op.name]
      if (Object.keys(section).length === 0) delete next[op.target]
      fileOps.push({ op: 'delete', target: op.target, name: op.name })
      summary.push(`removed ${singular(op.target)} "${op.name}"`)
      break
    }

    case 'set-facet-meta': {
      const applied = applyFacetMeta(next, op.fields)
      if (!applied.ok) return { ok: false, error: applied.error }
      summary.push(...applied.summary)
      break
    }
  }

  // Re-validate the mutated manifest before handing it back. A mutation that
  // breaks the manifest is rejected here so the caller writes nothing.
  const validated = validateFacetManifest(JSON.stringify(next))
  if (!validated.ok) {
    return {
      ok: false,
      error: { reason: 'manifest-invalid', messages: validated.errors.map((e) => e.message) },
    }
  }

  return { ok: true, manifest: validated.data, fileOps, summary }
}

// --- helpers ---

type Section = Record<string, unknown>

function getSection(manifest: FacetManifest, target: AssetTarget): Section | undefined {
  return manifest[target] as Section | undefined
}

function ensureSection(manifest: FacetManifest, target: AssetTarget): Section {
  const existing = manifest[target] as Section | undefined
  if (existing) return existing
  const created: Section = {}
  ;(manifest as Record<string, unknown>)[target] = created
  return created
}

function applyMutations(
  descriptor: AssetDescriptor,
  mutations: FieldMutation[],
): { ok: true; summary: string[] } | { ok: false; error: MutationError } {
  const summary: string[] = []
  for (const mutation of mutations) {
    switch (mutation.field) {
      case 'description':
        descriptor.description = mutation.value
        summary.push('set description')
        break
      case 'adapter': {
        if (!descriptor.adapters) descriptor.adapters = {}
        descriptor.adapters[mutation.adapter] = mutation.config
        summary.push(`set adapter "${mutation.adapter}" config`)
        break
      }
      case 'remove-adapter': {
        if (!descriptor.adapters || descriptor.adapters[mutation.adapter] === undefined) {
          return { ok: false, error: { reason: 'adapter-not-found', adapter: mutation.adapter } }
        }
        delete descriptor.adapters[mutation.adapter]
        if (Object.keys(descriptor.adapters).length === 0) delete descriptor.adapters
        summary.push(`removed adapter "${mutation.adapter}" config`)
        break
      }
    }
  }
  return { ok: true, summary }
}

/** Complete a mutation-level error with the enclosing asset's target and name. */
function completeMutationError(error: MutationError, target: AssetTarget, name: string): ApplyModifyError {
  return { reason: 'adapter-not-found', target, name, adapter: error.adapter }
}

function applyFacetMeta(
  manifest: FacetManifest,
  fields: FacetMetaFields,
): { ok: true; summary: string[] } | { ok: false; error: ApplyModifyError } {
  const summary: string[] = []
  const target = manifest as Record<string, unknown>
  if (fields.name !== undefined) {
    target.name = fields.name
    summary.push(`set name to "${fields.name}"`)
  }
  if (fields.description !== undefined) {
    target.description = fields.description
    summary.push('set description')
  }
  if (fields.version !== undefined) {
    target.version = fields.version
    summary.push(`set version to "${fields.version}"`)
  }
  if (fields.private !== undefined) {
    if (fields.private) {
      target.private = true
      summary.push('set private to true')
    } else {
      delete target.private
      summary.push('set private to false (public)')
    }
  }
  if (summary.length === 0) return { ok: false, error: { reason: 'no-such-facet-field' } }
  return { ok: true, summary }
}

/** The on-disk relative path for an asset of the given target and name. */
export function assetPath(target: AssetTarget, name: string): string {
  return target === 'skills' ? `skills/${name}/SKILL.md` : `${target}/${name}.md`
}

/** Render a plural manifest key as its singular noun for summaries. */
function singular(target: AssetTarget): string {
  return target.slice(0, -1)
}
