import { THEME } from '../../theme.ts'

/**
 * The three states a claimant can be in while collisions are being
 * resolved, and how each one is shown.
 *
 * Color alone cannot carry this. Roughly one in twelve men cannot
 * reliably separate the red and green ends of the scale, `NO_COLOR` is a
 * supported environment, and piped output drops styling entirely. So
 * every state ships an icon AND a word, and the color is decoration on
 * top of an already-complete signal.
 */
export type CollisionStatus =
  /** The set still collides here and no in-session edit has addressed it. */
  | 'unresolved'
  /** This claimant collides with a name the current draft proposes. */
  | 'draft-conflict'
  /** This claimant's effective identity is unique across the whole draft. */
  | 'resolved'

export interface CollisionStatusPresentation {
  /** Distinct at a glance without reading. */
  icon: string
  /** Distinct when the icon does not render (or is read aloud). */
  label: string
  color: string
}

/**
 * Keyed exhaustively on purpose: adding a fourth state to
 * {@link CollisionStatus} fails to compile until it is given a
 * presentation, rather than rendering as a blank cell.
 */
export const COLLISION_STATUS: Record<CollisionStatus, CollisionStatusPresentation> = {
  unresolved: { icon: '✕', label: 'unresolved', color: THEME.warning },
  'draft-conflict': { icon: '⚠', label: 'conflict', color: THEME.caution },
  resolved: { icon: '✓', label: 'resolved', color: THEME.success },
}

/**
 * The color-free rendering of a status, e.g. `✕ unresolved`. Used by the
 * views and asserted directly by the accessibility tests, so the promise
 * the tests check is the same string users see.
 */
export function describeStatus(status: CollisionStatus): string {
  const { icon, label } = COLLISION_STATUS[status]
  return `${icon} ${label}`
}
