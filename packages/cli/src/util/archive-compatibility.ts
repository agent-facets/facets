/**
 * The single CLI-side compatibility table mapping a known archive format to
 * the minimum `agent-facets` release that supports it (design D4, task 9.8).
 *
 * This is the ONE authoritative place the CLI turns an unsupported
 * archive-format failure into actionable upgrade guidance. For a KNOWN newer
 * format, it names the minimum supporting release ("update agent-facets to
 * <version> or later"). For an UNKNOWN future format, it advises updating to
 * the latest release without inventing a minimum version — an already-shipped
 * CLI cannot know the minimum release for a format defined after it was built.
 *
 * The table intentionally lives in the CLI, not the protocol: it maps a spec
 * artifact version to a specific npm package release, which is a distribution
 * fact this CLI owns, not a normative part of the protocol.
 */

/**
 * Known archive-format → minimum supporting `agent-facets` release. Keys are
 * the exact numeric `facetVersion` values rendered as strings (the form the
 * verifier reports as `observed`). Extend this map when a future format ships
 * with a known minimum CLI release.
 *
 * `0.1` and `0.2` are the formats THIS CLI already supports, so they never
 * reach the unsupported-format path; the table is for formats NEWER than what
 * a given installed CLI understands. It is seeded with the `0.2` boundary so
 * an older pre-`0.2` CLI (which lacks this table entirely) is the only build
 * that shows a generic message — every `0.2`-aware release maps known newer
 * formats precisely as they are added.
 */
const MINIMUM_RELEASE_FOR_FORMAT: Readonly<Record<string, string>> = {
  // The first `agent-facets` release that emits/consumes the `0.2` archive
  // format. A CLI that supports `0.2` never renders `0.2` as unsupported; this
  // entry is what an *older* pre-`0.2` CLI is told to update to.
  '0.2': '0.31.0',
}

export interface ArchiveCompatibilityGuidance {
  /** The one-line "what went wrong" summary. */
  what: string
  /** Supporting detail (supported formats, and a minimum release when known). */
  detail: string
  /** The actionable fix line. */
  fix: string
}

/**
 * Render actionable upgrade guidance for an unsupported archive format.
 *
 * @param observed  the archive's declared `facetVersion` (string), or
 *                  `undefined` when the archive did not declare a parseable
 *                  version.
 * @param supported the archive formats this CLI supports.
 */
export function archiveCompatibilityGuidance(
  observed: string | undefined,
  supported: readonly string[],
): ArchiveCompatibilityGuidance {
  if (observed === undefined) {
    return {
      what: 'this facet uses an archive format this CLI does not recognize',
      detail: `supported archive formats: ${supported.join(', ')}`,
      fix: 'update agent-facets to the latest release with `facet self-update` and try again',
    }
  }

  const minimumRelease = MINIMUM_RELEASE_FOR_FORMAT[observed]
  if (minimumRelease !== undefined) {
    return {
      what: `this facet uses archive format ${observed}, which this CLI does not support`,
      detail: `supported archive formats: ${supported.join(', ')}`,
      fix: `update agent-facets to ${minimumRelease} or later (e.g. \`facet self-update\`) and try again`,
    }
  }

  // Unknown future format: no minimum is invented.
  return {
    what: `this facet uses archive format ${observed}, which this CLI does not support`,
    detail: `supported archive formats: ${supported.join(', ')}`,
    fix: 'update agent-facets to the latest release with `facet self-update` and try again',
  }
}
