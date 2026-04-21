type BrandMarkProps = {
  size?: number
  className?: string
}

/**
 * The Agent Facets wordmark glyph — four horizontal stripes in the accent
 * palette, evoking stacked facets.
 */
export function BrandMark({ size = 26, className }: BrandMarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <rect x="4" y="4" width="24" height="4" rx="1" fill="var(--accent-c)" />
      <rect x="4" y="10" width="24" height="4" rx="1" fill="var(--accent-a)" />
      <rect x="4" y="16" width="24" height="4" rx="1" fill="var(--accent-b)" />
      <rect x="4" y="22" width="24" height="4" rx="1" fill="var(--accent-d)" />
    </svg>
  )
}
