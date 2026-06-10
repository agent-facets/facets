---
title: facet login
sidebarTitle: ' '
description: Sign in to the facet registry
tag: facet login
---

## Usage

```sh
facet login
```

Signs in to the registry by pasting a personal access token (PAT). Requires an interactive terminal.

## What it does

1. **Prompt for token.** Presents an interactive menu. Select "Paste a token" and paste the PAT from your account at [facet.cafe](https://facet.cafe).
2. **Verify token.** Calls `GET /v0/auth/me` to confirm the token is valid. A typo or expired token fails immediately with the registry's own error message, and you are reprompted.
3. **Persist credential.** Writes the verified token to `$FACET_DIR/credentials` (default `~/.facet/credentials`) in INI format with mode `0600`.

## Credential file format

```ini
[default]
token = facet_pat_xxxxxxxxxxxxx
```

The file is created with `0600` permissions so only the current user can read it.

## Token precedence

When both `FACET_TOKEN` and the credentials file are present, `FACET_TOKEN` takes precedence. The `login` command notes this so the environment variable does not silently shadow the file.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Signed in successfully. |
| `1`  | Failed (non-interactive terminal, invalid token, network error). |

## See also

- [`facet whoami`](/cli/whoami) -- verify the signed-in identity.
- [`facet logout`](/cli/logout) -- remove saved credentials.
- [`facet publish`](/cli/authoring/publish) -- publish a facet (requires authentication).
