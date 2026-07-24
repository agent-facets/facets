import { validateAssetNameSegment } from '@agent-facets/protocol'
import type { AssetSectionKey, FormState } from '../context/form-state-context.ts'

/**
 * Shared wizard-level asset-name validation for both the create and edit
 * views. Returns an error string to display, or `undefined` when the name is
 * acceptable at input time.
 *
 * Enforces three rules, in order:
 *   1. the current single-segment asset-name grammar;
 *   2. uniqueness within the asset's own type (excluding the item being
 *      edited);
 *   3. the shared skill/command namespace — skills and commands MUST be
 *      disjoint, so a name already used by the sibling type is rejected.
 *      Agents occupy a separate namespace and are exempt.
 *
 * Rule 3 mirrors the build/schema collision check (`facet-manifest.ts`), so an
 * author is told about a shared-namespace collision at the wizard rather than
 * only at build time.
 */
export function validateAssetNameInWizard(
  type: AssetSectionKey,
  value: string,
  assets: FormState['assets'],
): string | undefined {
  const check = validateAssetNameSegment(value)
  if (!check.ok) return `Name ${check.reason}`

  const editing = assets[type].editing
  if (assets[type].items.some((item) => item === value && item !== editing)) {
    return `"${value}" already exists`
  }

  const sibling = type === 'skill' ? 'command' : type === 'command' ? 'skill' : undefined
  if (sibling && assets[sibling].items.some((item) => item === value)) {
    return `"${value}" is already used by a ${sibling} (skills and commands share one namespace)`
  }

  return undefined
}
