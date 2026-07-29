/**
 * Code-unit string ordering, for every artifact whose order is part of its
 * contract.
 *
 * Not `localeCompare`: locale collation depends on the process locale and the
 * runtime's ICU data, and gives `@` and `/` variable weight — so two machines
 * can order the same scoped facet names differently and produce a diff that
 * reflects the environment rather than a change.
 *
 * Lives in protocol because the planner, the removal-refinement rebuild, and
 * the lockfile writer must agree, or a set can round-trip through them and
 * come back reordered.
 */
export function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
