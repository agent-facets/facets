---
title: facet logout
description: Remove saved registry credentials
---

## Usage

```sh
facet logout
```

Removes the saved credentials file. No server call is made -- token revocation is done in the web UI at [agentfacets.io](https://agentfacets.io).

## What it does

1. **Delete credentials file.** Removes `$FACET_DIR/credentials` (default `~/.facet/credentials`).
2. **Warn about FACET_TOKEN.** If the `FACET_TOKEN` environment variable is set, the CLI warns that it will continue to authenticate commands. Run `unset FACET_TOKEN` to fully sign out of the current shell.

## Exit codes

| Code | Meaning |
| ---- | ------- |
| `0`  | Credentials removed (or file did not exist). |
| `1`  | Failed (filesystem error). |

## See also

- [`facet login`](/cli/login) -- sign in to the registry.
- [`facet whoami`](/cli/whoami) -- verify the signed-in identity.
