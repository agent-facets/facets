import { isAbsolute, resolve } from 'node:path'
import type { McpServersPlan } from '@agent-facets/adapter'
import { canonicalPathKey } from '../../fs'
import type { McpContractViolation } from './prepare.ts'

/**
 * Which adapter reconciles which native document, and what happens when two
 * of them answer with the same file.
 *
 * Nothing here reads or writes anything. A plan's disclosed documents are a
 * selection-time fact only: they decide whether this set of adapters can be
 * reconciled at all, and confer no ownership over the files they name.
 */

/** One adapter's claim on a native document, in the spelling it used. */
export interface McpDocumentClaimant {
  readonly adapter: string
  readonly path: string
}

/**
 * A native document more than one selected adapter reconciles.
 *
 * The claimants carry their own spellings rather than one derived path: two
 * adapters naming the same file differently is exactly the case this detects,
 * and a single canonical path in the report would have to pick one of them to
 * show a user who wrote the other.
 *
 * At least two claimants, refined at the boundary — {@link
 * detectMcpDocumentOverlap} is the only constructor, and it reports no group
 * rather than a group of one.
 */
export interface McpDocumentOverlap {
  readonly claimants: readonly McpDocumentClaimant[]
}

/** One adapter's plan, as much of it as document checking needs. */
export interface DisclosedMcpDocuments {
  readonly adapter: string
  readonly plan: McpServersPlan
}

/**
 * Check that a plan's disclosure can be trusted, before anything is compared
 * against it.
 *
 * The overlap check below is only as sound as the lists it reads: an adapter
 * that disclosed nothing, or that changed a document it never mentioned,
 * would slip past a comparison that assumed otherwise. Every failure here is
 * an adapter bug — a typed adapter cannot express any of them.
 */
export function validateDisclosedDocuments(entry: DisclosedMcpDocuments): McpContractViolation | null {
  const { adapter, plan } = entry
  // Read as unknown, not as its declared type: the whole reason this function
  // exists is that the plan came from a bundle nothing type-checked, where the
  // field can be missing outright.
  const disclosed: unknown = plan.documentPaths
  if (!Array.isArray(disclosed) || disclosed.length === 0) return { kind: 'documents-undisclosed', adapter }

  const seen = new Set<string>()
  for (const path of disclosed) {
    if (typeof path !== 'string' || !isAbsolute(path) || resolve(path) !== path) {
      return {
        kind: 'document-path-invalid',
        adapter,
        path: typeof path === 'string' ? path : String(path),
        detail: 'must be an absolute, normalized path',
      }
    }
    const key = canonicalPathKey(path)
    if (seen.has(key)) {
      return { kind: 'document-path-invalid', adapter, path, detail: 'is disclosed more than once' }
    }
    seen.add(key)
  }

  if (plan.action.kind === 'mutate') {
    for (const mutation of plan.action.mutations) {
      if (!seen.has(canonicalPathKey(mutation.path))) {
        return { kind: 'mutation-undisclosed', adapter, path: mutation.path }
      }
    }
  }
  return null
}

/**
 * Every native document two or more selected adapters both reconcile.
 *
 * Groups, not the first collision: a user marched through repeated attempts
 * to discover one conflict at a time learns nothing about the shape of the
 * problem — the same reason asset collisions and unsupported adapters are
 * reported whole.
 */
export function detectMcpDocumentOverlap(entries: readonly DisclosedMcpDocuments[]): McpDocumentOverlap[] {
  const byDocument = new Map<string, McpDocumentClaimant[]>()
  for (const { adapter, plan } of entries) {
    // Every entry reaching here passed {@link validateDisclosedDocuments}.
    for (const path of plan.documentPaths) {
      const key = canonicalPathKey(path)
      const claimants = byDocument.get(key)
      if (claimants === undefined) byDocument.set(key, [{ adapter, path }])
      else claimants.push({ adapter, path })
    }
  }

  const overlaps: McpDocumentOverlap[] = []
  for (const claimants of byDocument.values()) {
    if (claimants.length > 1) overlaps.push({ claimants })
  }
  return overlaps
}
