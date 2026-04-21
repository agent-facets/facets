# Deploy Pipeline

Continuous deployment (CD) of the SST `main` stage on every push to `main`.

## Flow

```
Push to main
  │
  ▼
┌────────────────────────────────────────────────────────────────────┐
│  deploy-site CircleCI job (deploy workflow, release pipeline)      │
│                                                                    │
│  1. setup-mise       — install Bun, node, deps                     │
│  2. aws-oidc-setup   — assume AWS_ROLE_ARN via OIDC (aws-cli orb)  │
│  3. bun scripts/deploy/site.ts                                     │
│       a. Pre-flight: AWS_ACCESS_KEY_ID must be set                 │
│       b. bun sst install   (CI's postinstall skips it)             │
│       c. bun sst deploy --stage main                               │
│  4. notify-failure   — Slack hook on failure                       │
└────────────────────────────────────────────────────────────────────┘
```

Defined in `.circleci/release/jobs/deploy-site.yml` and
`.circleci/release/workflows/deploy.yml`. Lives in the release pipeline because
deployment is part of the release lifecycle; the development pipeline is
reserved for PR-time CI checks.

## Scripts

| Script    | CircleCI Job  | Purpose                                                    |
|-----------|---------------|------------------------------------------------------------|
| `site.ts` | `deploy-site` | Install SST platform files, then `sst deploy --stage main` |

## Required CircleCI context

`sst` context with one variable:

| Variable       | Value                                                    |
|----------------|----------------------------------------------------------|
| `AWS_ROLE_ARN` | `arn:aws:iam::<account-id>:role/<ci-deploy-role>`        |

The role must trust the CircleCI OIDC provider for the `agent-facets` org and
be scoped to this project by `project-id`. For the one-time AWS-side setup see
[CircleCI: Using OpenID Connect tokens in jobs — Set up AWS][oidc-aws].

[oidc-aws]: https://circleci.com/docs/guides/permissions-authentication/openid-connect-tokens/#set-up-aws

## Manual redeploy

Re-run the `deploy-site` job from the CircleCI UI for the relevant `main`
commit, or push an empty commit to `main`:

```sh
git commit --allow-empty -m "chore: redeploy"
git push origin main
```

## Why CD sits in the release pipeline

- **CI** (`.circleci/development/`) runs on PRs and handles automated checks
  that gate merge.
- **CD** (`.circleci/release/`) runs on `main` and on release tags, and handles
  everything that actually ships to users — npm publishes, CLI binaries, and
  the SST deploy of `agentfacets.io`.

The `deploy` workflow runs in parallel with `main-pipeline` (which re-runs
`check` on `main`). CI already passed on the PR pre-merge, so gating the
deploy on a second `check` run is redundant.
