# Library Release Pipeline

Publishes `@agent-facets/core`, `@agent-facets/brand`, and any future public library packages to npm.

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

| Script       | CircleCI Job    | Trigger                        | Purpose                                                       |
|--------------|-----------------|--------------------------------|---------------------------------------------------------------|
| `version.ts` | `main-pipeline` | Push to `main`                 | Run `changeset version`, create/update Version Packages PR    |
| `tag.ts`     | `main-pipeline` | Push to `main`                 | Detect merged version PR, create git tags for bumped packages |
| `publish.ts` | `release`       | Tag push (`@agent-facets/*@*`) | Build and publish one library package to npm                  |

## Private Package Guard

`publish.ts` checks `pkg.private` before publishing. If a private package's tag triggers the release workflow (e.g., an internal adapter package), the script logs a skip message and exits cleanly. This prevents accidental npm publish attempts for internal packages.
