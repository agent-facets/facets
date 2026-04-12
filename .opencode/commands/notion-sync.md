---
description: Audit and sync .opencode/notion.json against the live Notion workspace
---

Audit `.opencode/notion.json` against the live Notion workspace. Find discrepancies in databases, views, and templates, then propose and apply fixes with user approval.

## Workflow

### Step 1: Discover

1. Read `.opencode/notion.json` to get the current configuration.

2. Build the audit prompt for the Notion agent. For each database in the config, the agent must:
   - Fetch the database details from Notion
   - List ALL views with their names and IDs
   - List ALL templates with their names and IDs
   - Compare against what's in the config

3. Delegate to the Notion agent using the **Task tool** (`subagent_type: "notion"`) with this prompt:

   > I need a full audit of the Notion workspace against a configuration file.
   >
   > **Part 1: Check existing databases**
   >
   > For each of the following databases, fetch the database details and list ALL views (names + IDs) and ALL templates (names + IDs). Then compare against the expected values I provide.
   >
   > [Include each database entry from notion.json with its database_id, and the expected templates and views]
   >
   > For each database, report:
   > - **STALE**: Template or view IDs in the config that no longer exist in Notion
   > - **MISMATCH**: Config keys where the Notion name has changed (include old key and new suggested key)
   > - **MISSING**: Templates or views that exist in Notion but are not in the config (include name and ID)
   >
   > **Part 2: Discover new databases**
   >
   > List ALL data sources in the workspace. Compare against the database IDs in the config. For any database that exists in Notion but is NOT in the config, report:
   > - Database name
   > - Database ID
   > - Data source ID
   > - All templates (names + IDs)
   > - All views (names + IDs)
   >
   > **Output format**: Return a structured report organized by database, with clear sections for STALE, MISMATCH, MISSING, and NEW DATABASE entries. If a database has no discrepancies, report it as "up to date".

4. Parse the Notion agent's response.

### Step 2: Propose

**CRITICAL: You MUST present EVERY discrepancy to the user, no matter how minor or cosmetic. You are NOT permitted to skip, dismiss, or auto-resolve any finding. Even if a config key seems like a "reasonable shorthand" or a mismatch seems trivial, the user decides — not you.**

1. If there are **zero** discrepancies of any kind (no STALE, no MISMATCH, no MISSING, no NEW DATABASE), report:
   > `.opencode/notion.json` is up to date. No changes needed.

   Then stop.

2. If there are ANY discrepancies at all, first show a full summary table of all findings organized by database:

   | Database | Change | Type | Key | Details |
   |----------|--------|------|-----|---------|
   | SDR Relationships | MISMATCH | view | `all` → `all_relationships` | Notion name is "All Relationships" |
   | Tasks | MISSING | template | `suggested_key` | "Template Name" (`id`) exists in Notion but not in config |

   For new databases, also show the full proposed entry (database_id, data_source_id, templates, views).

3. Then use the **question tool** to ask the user about **each change individually**. Each discrepancy gets its own question with clear options:
   - For STALE: "Remove `key` from `database.views/templates`?" — Yes / No
   - For MISMATCH: "Rename `old_key` to `new_key` in `database.views/templates`?" — Yes / No
   - For MISSING: "Add `suggested_key` to `database.views/templates`?" — Yes / No
   - For NEW DB: "Add new database `suggested_key`?" — Yes / No

   You MAY batch multiple questions into a single `question` tool call (one question per discrepancy), but every discrepancy MUST be its own question. The user approves or rejects each change independently.

   **Do NOT proceed to Step 3 until the user has responded to every question.**

### Step 3: Apply

1. Read `.opencode/notion.json`.

2. Apply ONLY the changes the user approved (answered "Yes" to). Skip any the user rejected:
   - **STALE**: Remove the stale template/view entries from the relevant database
   - **MISMATCH**: Rename the config key to match the new Notion name (convert to snake_case)
   - **MISSING**: Add the new template/view entry under the relevant database
   - **NEW DB**: Add the entire new database entry with all its templates and views

3. Write the updated `.opencode/notion.json`.

4. Show a final summary of all changes applied.

## Guardrails

- **NEVER skip a discrepancy.** Every finding — stale, mismatch, missing, or new — MUST be shown to the user. You do not get to decide what is "minor" or "cosmetic." The user decides.
- **NEVER auto-resolve.** Even if a config key seems like a reasonable shorthand for a Notion name, present it as a mismatch and let the user choose.
- Each change must be approved individually — the user may accept some and reject others
- The Notion agent handles all Notion API interaction; this command only reads/writes `.opencode/notion.json`
- If the Notion agent returns an error or incomplete data, report it to the user and stop
- New database config keys should be snake_case derived from the database name
- Preserve the existing JSON formatting and key ordering where possible
