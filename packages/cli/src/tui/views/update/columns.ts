/**
 * Column layout shared by the two update tables.
 *
 * The dry-run plan and the interactive picker are different screens —
 * one has a `declared` column, the other has focus and selection
 * markers — but they show the same versions and have to line them up
 * the same way. Two implementations of "how wide is this column" is how
 * one of them ends up misaligned in a way no whitespace-collapsing test
 * can see.
 */

/**
 * Two spaces between columns, not one.
 *
 * Every cell here is digits and dots, and a single space lets `1.2.0`
 * and `1.8.0` read as one run of characters. Two is the smallest gutter
 * that keeps the columns separable at a glance.
 */
export const COLUMN_GAP = '  '

/**
 * The header labels, named once.
 *
 * Each is used twice — printed in the header row, and used to seed that
 * column's width — and the two uses must be the same string or the
 * header sits over the wrong column.
 */
export const COLUMN_HEADERS = {
  facet: 'facet',
  declared: 'declared',
  current: 'current',
  target: 'target',
  latest: 'latest',
} as const

/**
 * How wide a column has to be: its header, or its widest value.
 *
 * Seeding from the header is the part that is easy to forget and
 * invisible in a test that collapses whitespace. `declared` is eight
 * characters and `1.*` is three, so a width taken from the values alone
 * lets the header overflow its own column and shift every column after
 * it — a table that only looks wrong when a human reads it.
 */
export function columnWidth(header: string, values: readonly string[]): number {
  return values.reduce((max, value) => Math.max(max, value.length), header.length)
}
