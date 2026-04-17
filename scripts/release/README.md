# Library Release Pipeline

Publishes `@agent-facets/core`, `@agent-facets/brand`, `@agent-facets/adapter`, `@agent-facets/adapter-*`, and any future public library/adapter packages to npm.

## Flow

```
Tag push: @agent-facets/core@X.Y.Z
  │
  ▼
┌──────────────────────────────────────────────┐
│  release/publish.ts                          │
│                                              │
│  1. Parse package name + version from tag    │
│  2. Find package in workspace                │
│  3. Skip if private (guard)                  │
│  4. Mint OIDC token (npm trusted publishing) │
│  5. Build via turbo                          │
│  6. npm publish --access public              │
│  7. Create GitHub Release                    │
│  8. Send Slack notification                  │
└──────────────────────────────────────────────┘
```

## Scripts

| Script              | CircleCI Job    | Trigger                        | Purpose                                                       |
|---------------------|-----------------|--------------------------------|---------------------------------------------------------------|
| `version.ts`        | `main-pipeline` | Push to `main`                 | Run `changeset version`, create/update Version Packages PR    |
| `tag.ts`            | `main-pipeline` | Push to `main`                 | Detect merged version PR, create git tags for bumped packages |
| `publish.ts`        | `release`       | Tag push (`@agent-facets/*@*`) | Build and publish one library package to npm                  |
| `seed-adapters.ts`  | (manual)        | One-time bootstrap             | Seed adapter/library package names on npm with v0.0.1         |

## Private Package Guard

`publish.ts` checks `pkg.private` before publishing. If a private package's tag triggers the release workflow (e.g., an internal adapter package), the script logs a skip message and exits cleanly. This prevents accidental npm publish attempts for internal packages.

## Seeding New Library/Adapter Packages

Before a brand-new `@agent-facets/*` package can be published by the tag pipeline, its name must exist on npm so that OIDC trusted publishing can be configured on the package's access page. Run `bun seed:adapters` locally (requires `npm login`) to publish `v0.0.1` placeholders for any non-private workspace packages missing from the registry, then follow the printed instructions to configure each package's trusted publisher. After OIDC is configured, the normal tag-triggered pipeline takes over.

The CLI platform packages (`@agent-facets/cli-*`) are seeded by `scripts/release-cli/seed.ts` (`bun seed:cli`), not this script.
