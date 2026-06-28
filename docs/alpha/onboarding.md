# Closed-alpha Onboarding

Welcome. You are invited to help dogfood Agent Facets before open beta. In about five minutes you will have the CLI installed, a real facet running in your AI tool of choice, and a repeatable update flow. Everything below is the full, current, supported path  -- no optional branches, no roadmap features sneaking in.

## What you'll have when done

- `facet` on your `$PATH` (a Bun-compiled binary, no runtime needed).
- A git clone of the alpha dogfood repo (`viper-plans`).
- Your AI tooling (Claude Code, OpenCode, or both) seeing a new skill + command contributed by the facet.

## 5 steps

1. **Install the CLI.**
   ```shell
   npm install -g agent-facets
   ```

2. **In any project, add the dogfood facet.**
   ```shell
   facet add github:agent-facets/viper-plans
   ```
   This single command resolves the source, fetches it, verifies integrity, and installs the assets into every connected adapter. There's no separate `facet install` step.

   (You can also run it against a local clone: `facet add ./path/to/viper-plans`.)

3. **Pick your adapter.** If you have no adapters installed yet, a picker shows up before the install runs:
   ```
   No AI tools are connected yet. Pick which adapter to install.

     ▸ ○ claude-code
       ○ opencode
       ○ codex
       ○ copilot

   ↑↓ move · Space toggle · Enter confirm · Esc cancel
   ```
   Select the adapter(s) you use with **Space**, then press **Enter**. The install resumes automatically.

4. **Wait for the summary.** Expect something like:
   ```
   Adding facets...

     + viper-plans@0.1.0

     Done.
     1 installed · 1 asset written
   ```

5. **Restart your AI tool.** Claude Code, OpenCode, or whatever you picked. The new skill and command appear in that tool's listing.

If you're returning to an existing facet project (e.g., a fresh `git clone`), use `facet install` instead  -- it reads the existing `facets.json` and `facets.lock` and reapplies everything without touching the manifest.

## Verification

Open your tool, list skills or commands, and confirm the new ones from viper-plans are there. If they are, the install worked end-to-end.

## If something fails

Re-run `facet install --verbose` and post the full terminal output to the `#closed-alpha` channel in Discord. That's the single piece of info that unblocks debugging  -- the verbose stream shows which step (resolve / fetch / diff / install-per-adapter / lockfile-write) fell over and what the adapter or git said. Don't truncate.

## Closed-alpha caveats

Worth knowing before you file a bug:

- **Integrity verification is per-source-kind.** Registry sources run a three-check protocol on download and a self-audit + lockfile comparison (or registry integrity confirmation) on cache hits -- cached content is never trusted at face value. A lockfile entry for a registry facet is never created without same-operation confirmation against the registry's published `content_integrity`. Git sources run a single check: computed content vs. lockfile integrity, defending against tag-move attacks. Local sources are trust-by-path in normal mode; `--frozen-lockfile` verifies them against the lockfile. The lockfile is a real integrity contract -- re-installing from a moving ref that's been retagged or force-pushed will fail with a security error.
- **Orphan cleanup is automatic.** `facet remove` deletes a facet's assets from every adapter. The install pipeline maintains a machine-local receipt that tracks what has been materialized, so a `git pull` that drops a lockfile entry still cleans up correctly on the next install.
- **Two facets that ship the same asset name will collide** (e.g., two facets with `skill:planning`). Second install wins; uninstalling either side deletes the other's asset. Cross-facet collision detection is a post-alpha fast-follow.

Ping in Discord if any of these bite you and we'll prioritize.
