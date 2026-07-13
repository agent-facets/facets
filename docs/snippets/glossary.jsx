export const DeltaTip = ({ children }) => (
  <Tooltip
    tip="Additions (the user's specifier verbatim) plus removals (bare names); facet install produces an empty delta."
    cta="See the delta"
    href="/specification/planning#the-delta"
  >
    {children}
  </Tooltip>
)

export const InstallReceiptTip = ({ children }) => (
  <Tooltip
    tip="The machine-local, per-project record under $FACET_DIR/receipts/ tracking what this machine has materialized; drives offline drift removal."
    cta="See receipt section"
    href="/specification/commit#machine-local-install-receipt"
  >
    {children}
  </Tooltip>
)

export const CanonicalFingerprintTip = ({ children }) => (
  <Tooltip
    tip="SHA-256 of the uncompressed inner tar (content_integrity); the trust anchor recorded in the lockfile, cache sidecar, and build manifest."
    cta="See integrity model"
    href="/specification/integrity#two-hashes-two-domains"
  >
    {children}
  </Tooltip>
)

export const SidecarTip = ({ children }) => (
  <Tooltip
    tip="cache-integrity.json, stored alongside cached content; the canonical fingerprint plus per-asset hashes, written at cache-populate time."
    cta="See where hashes live"
    href="/specification/integrity#where-hashes-live"
  >
    {children}
  </Tooltip>
)
