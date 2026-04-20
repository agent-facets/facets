# Closed-alpha Onboarding

Welcome. You are invited to help dogfood Agent Facets before open beta. In about five minutes you will have the CLI installed, a real facet running in your AI tool of choice, and a repeatable update flow. Everything below is the full, current, supported path — no optional branches, no roadmap features sneaking in.

## What you'll have when done

- `facet` on your `$PATH` (a Bun-compiled binary, no runtime needed).
- A git clone of the alpha dogfood repo (`viper-plans`).
- Your AI tooling (Claude Code, OpenCode, or both) seeing a new skill + command contributed by the facet.

## 6 steps

1. **Install the CLI.**
   ```shell
   npm install -g agent-facets
   ```

2. **Clone the dogfood repo.**
   ```shell
   git clone <viper-plans-url>
   cd <viper-plans-directory>
   ```

3. **Run the installer.**
   ```shell
   facet install
   ```

4. **Pick your adapter.** If you have no adapters installed yet, a picker shows up:
   ```
   No AI tools are connected yet. Pick which adapter to install.

     ▸ ○ claude-code
       ○ opencode
       ● codex (install support coming soon)     ← dimmed, non-selectable

   ↑↓ move · Space toggle · Enter confirm · Esc cancel
   ```
   Select the adapter(s) you use with **Space**, then press **Enter**.

5. **Wait for the success line.** Expect something like:
   ```
   ✓ Installed viper-plans@0.1.0 for claude-code. 2 assets written.
     Restart Claude Code to see your new assets.
   ```

6. **Restart your AI tool.** Claude Code, OpenCode, or whatever you picked. The new skill and command appear in that tool's listing.

## Verification

Open your tool, list skills or commands, and confirm the new ones from viper-plans are there. If they are, the install worked end-to-end.

## If something fails

Re-run `facet install --verbose` and post the full terminal output to the `#closed-alpha` channel in Discord. That's the single piece of info that unblocks debugging — the verbose stream shows which step (resolve / fetch / diff / install-per-adapter / lockfile-write) fell over and what the adapter or git said. Don't truncate.

## Closed-alpha caveats

Worth knowing before you file a bug:

- **`facets.lock` is an audit log, not a tamper check.** Each entry carries an `integrity` hash of the built artifact, but `facet install` does not re-verify that hash on subsequent runs. A moving ref (`#main`, retagged release, force-push) will pull new bytes. Treat the lockfile as a record of what you installed, not a guarantee that re-running installs the same bytes. Integrity enforcement is a post-alpha fast-follow.
- **Removing a facet from `facets.json` leaves its assets on disk.** There is no orphan sweep yet — delete the corresponding files in `.claude/skills/<name>` / `.opencode/skills/<name>` manually, or clear the adapter tree and re-install.
- **Two facets that ship the same asset name will collide** (e.g., two facets with `skill:planning`). Second install wins; uninstalling either side deletes the other's asset. Cross-facet collision detection is also a post-alpha fast-follow.

All three of these are tracked together — ping in Discord if one bites you and we'll prioritize the fast-follow.
