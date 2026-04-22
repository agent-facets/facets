import { LinkCard } from './LinkCard'

type RegistryCtaProps = {
  className?: string
}

const MAGNIFYING_GLASS = (
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <title>magnifying glass</title>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

/**
 * Specific `LinkCard` that advertises the facet.cafe registry. Kept
 * as a convenience wrapper so call sites stay readable (`<RegistryCta />`
 * vs a wall of props) and so the registry URL + icon live in one place.
 * Used on mobile hero + closer where the install one-liner is hidden.
 */
export function RegistryCta({ className }: RegistryCtaProps) {
  return (
    <LinkCard
      href="https://facet.cafe/"
      label="Browse the registry"
      value="facet.cafe"
      icon={MAGNIFYING_GLASS}
      className={className}
    />
  )
}
