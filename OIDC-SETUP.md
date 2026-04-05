# OIDC Trusted Publishing Setup — CircleCI → npm

One-time setup for each new `@agent-facets/cli-*` platform package. This enables CI to publish packages with provenance attestation without storing npm tokens.

## When to use

After running `bun seed` to claim platform package names on npm. Each seeded package needs OIDC trusted publishing configured before CI can publish real binaries.

## Steps

### 1. Run the seed script

```bash
npm login          # one-time, uses your personal npm account
bun seed           # publishes v0.0.1 placeholders, prints package URLs
```

### 2. Configure trusted publishing on npm

For each package printed by the seed script:

1. Open the package's npm access page (URLs are printed by `bun seed`)
2. Under **Publishing access**, add a new trusted publisher
3. Enter the CircleCI OIDC values:

| Field                    | Value                                    |
| ------------------------ | ---------------------------------------- |
| **Organization ID**      | `d6dfd694-6b06-4d51-a5bd-a15b3efe977b`   |
| **Project ID**           | `c7b3dd0a-e9b0-4e95-8345-fc984443e02b`   |
| **Pipeline Definition ID** | `d404b478-dd19-4c68-891f-4cf97396b1a7` |
| **Context IDs**          | `e6caacea-c6b2-4e4f-b7e3-5cef922ab8a0`   |
| **VCS Origin**           | `github.com/agent-facets/facets`          |

4. Repeat for all 12 platform packages

The wrapper package (`agent-facets`) already has OIDC configured — no action needed for it.

### 3. Verify

Re-run `bun seed` to confirm all packages exist on npm. The script will report "All packages already exist on npm" if seeding was successful.

## How it works

CircleCI provides OIDC tokens via the `$CIRCLE_OIDC_TOKEN_V2` environment variable in CI jobs. When the publish script runs `npm publish --provenance`, npm validates the OIDC token against the trusted publisher configuration on each package. No npm auth tokens are stored in CI.

## Where to find these values

The CircleCI OIDC values come from project settings:

- **Organization ID**: CircleCI org settings
- **Project ID**: CircleCI project settings
- **Pipeline Definition ID**: CircleCI project pipeline settings
- **Context IDs**: CircleCI context settings
- **VCS Origin**: The GitHub repository URL (without `https://`)

## Platform packages

The 12 platform packages that need OIDC configuration:

```
@agent-facets/cli-darwin-arm64
@agent-facets/cli-darwin-x64
@agent-facets/cli-darwin-x64-baseline
@agent-facets/cli-linux-arm64
@agent-facets/cli-linux-arm64-musl
@agent-facets/cli-linux-x64
@agent-facets/cli-linux-x64-baseline
@agent-facets/cli-linux-x64-baseline-musl
@agent-facets/cli-linux-x64-musl
@agent-facets/cli-windows-arm64
@agent-facets/cli-windows-x64
@agent-facets/cli-windows-x64-baseline
```
