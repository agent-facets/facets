---
title: facet whoami
sidebarTitle: ' '
description: Print the signed-in identity
tag: facet whoami
---

## Usage

```sh
facet whoami
```

Prints the identity associated with the current credential by calling `GET /v0/auth/me`.

## What it does

1. **Resolve credential.** Checks `FACET_TOKEN` environment variable first, then the credentials file at `~/.facet/credentials`.
2. **Query registry.** Calls `GET /v0/auth/me` with the resolved token.
3. **Display identity.** Shows the username, email, account tier, and credential source.

## Output

```
yourname <you@example.com>
  tier: free
```

If the credential was resolved from `FACET_TOKEN` instead of the saved file:

```
yourname <you@example.com>
  tier: free
  credential: FACET_TOKEN (environment)
```

If the account is suspended, the suspended status is shown.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Identity displayed successfully. |
| `1`  | Failed (no credential found, invalid token, network error). |

## See also

- [`facet login`](/cli/login) -- sign in to the registry.
- [`facet logout`](/cli/logout) -- remove saved credentials.
