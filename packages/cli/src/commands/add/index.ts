import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Adapter } from '@agent-facets/adapter'
import {
  emptyFacetsJson,
  loadFacetsJson,
  loadInstalledAdapters,
  type ParseError,
  parseFacetSource,
  type RunInstallResult,
  runInstall,
  type Source,
  upsertFacetInManifest,
  writeFacetsJson,
} from '@agent-facets/engine'
import { render } from 'ink'
import { createElement } from 'react'
import type { Command } from '../../commands.ts'
import { InstallView } from '../../tui/views/install/install-view.tsx'
import { writeCliError } from '../../util/errors.ts'
import { pickAndInstallAdapters } from '../adapter/pick-and-install.ts'

/**
 * `facet add <source> [more sources...]` — adds one or more facets to
 * `facets.json` and immediately installs them.
 *
 * The pipeline:
 *   1. Parse every source up front (no I/O). Any parse error aborts
 *      before mutating disk.
 *   2. Discover installable adapters. If none and stdout is a TTY,
 *      auto-launch the adapter picker. Non-TTY → fail.
 *   3. Byte-snapshot `facets.json` for rollback.
 *   4. Write the new entries to `facets.json` (default-to-pinned for
 *      bare/wildcard versions; wildcard form preserved as written).
 *   5. Mount `<InstallView mode="add" />` and call `runInstall`.
 *   6. On `runInstall` failure, restore the manifest snapshot
 *      byte-for-byte so the project is exactly as it was pre-command.
 */
export const addCommand: Command = {
  name: 'add',
  description: 'Add a facet to facets.json and install it',
  usage: '<source> [more sources...]',
  implemented: true,
  flags: {
    verbose: { type: 'boolean', description: 'Show detailed step output on stderr' },
  },
  run: async (args, flags) => {
    if (args.length === 0) {
      writeCliError({
        what: 'missing source specifier',
        detail: 'facet add requires at least one source',
        fix: 'run: facet add <source>    (e.g. facet add github:agent-facets/viper-plans#main)',
      })
      return 1
    }

    const verbose = flags.verbose === true
    const onLog = verbose ? (line: string) => process.stderr.write(`${line}\n`) : undefined

    // Step 1: parse every source up front. No I/O happens here.
    const parsed: Array<{ specifier: string; source: Source }> = []
    for (const specifier of args) {
      const result = parseFacetSource(specifier)
      if (!result.ok) {
        writeParseError(specifier, result.error)
        return 1
      }
      parsed.push({ specifier, source: result.value })
    }

    const projectRoot = process.cwd()

    // Step 2: discover or pick adapters.
    const adapters = await ensureAdapters()
    if (adapters === null) {
      // ensureAdapters already wrote the appropriate CLI error.
      return 1
    }

    // Step 3: byte-snapshot facets.json for rollback.
    const facetsJsonPath = join(projectRoot, 'facets.json')
    const snapshot: Buffer | null = existsSync(facetsJsonPath) ? readFileSync(facetsJsonPath) : null

    // Step 4: write new entries to facets.json.
    // Each entry is keyed by the facet's name; that comes from the
    // facet's own facet.json which we'll learn during runInstall's
    // planFacet step. For now we use the user's specifier as both the
    // key candidate AND the value, then rely on runInstall to surface
    // any name mismatch via its MANIFEST_NAME_MISMATCH failure code —
    // but to write a sensible facets.json before the install runs, we
    // need the name now. Pre-resolve it cheaply by reading the source's
    // facet.json directly (the same loadManifest call runInstall makes
    // internally; doing it here too is the price of "write manifest
    // before install").
    const namesByIndex: string[] = []
    for (let i = 0; i < parsed.length; i++) {
      const entry = parsed[i]
      if (!entry) continue
      const name = await peekFacetName(entry.source, entry.specifier)
      if (name === null) {
        // peekFacetName already wrote a CLI error.
        return 1
      }
      namesByIndex[i] = name
    }

    // Now mutate facets.json with the new entries.
    const loaded = loadFacetsJson(projectRoot)
    if (!loaded.ok) {
      writeCliError({
        what: 'could not read facets.json',
        detail: loaded.error,
        fix: 'fix or delete the malformed facets.json and retry',
      })
      return 1
    }
    const json = loaded.existed ? loaded.data : emptyFacetsJson()
    for (let i = 0; i < parsed.length; i++) {
      const entry = parsed[i]
      const name = namesByIndex[i]
      if (!entry || !name) continue
      upsertFacetInManifest(json, name, entry.specifier)
    }
    writeFacetsJson(projectRoot, json)

    // Step 5: mount InstallView and run runInstall.
    const controller = new AbortController()
    const sigintHandler = () => {
      process.stderr.write('\nInterrupted. Rolling back...\n')
      controller.abort()
    }
    process.on('SIGINT', sigintHandler)

    let captured: RunInstallResult | undefined
    const instance = render(
      createElement(InstallView, {
        mode: 'add',
        run: async (onStage) => {
          const result = await runInstall({
            projectRoot,
            adapters,
            onStage,
            onLog,
            signal: controller.signal,
          })
          captured = result
          return result
        },
        onComplete: (r) => {
          captured = r
        },
      }),
    )

    try {
      await instance.waitUntilExit()
    } catch {
      // Ink rejects on view-level failure; we have the captured result.
    } finally {
      process.off('SIGINT', sigintHandler)
    }

    // Step 6: on failure, restore the manifest snapshot.
    if (!captured?.ok) {
      restoreSnapshot(facetsJsonPath, snapshot)
      // Branch the user-facing guidance on whether `runInstall` succeeded
      // in undoing its asset writes. When `rollback.ok === false`, the
      // journal couldn't reverse some materialize operations and adapter
      // files may remain on disk — the user needs to know that rather
      // than be told "project state unchanged" and assume a clean retry.
      const rollbackFailed = captured !== undefined && !captured.rollback.ok
      const partialFailureCount =
        captured !== undefined && !captured.rollback.ok ? captured.rollback.partialFailures : 0
      writeCliError({
        what: 'add failed',
        detail: captured ? `code=${captured.failure.code}` : 'no result from install pipeline',
        fix: rollbackFailed
          ? `partial rollback: ${partialFailureCount} undo step(s) failed; some adapter files may remain. Inspect and clean manually before re-running 'facet add'.`
          : "rollback complete; project state unchanged. Fix the underlying issue and re-run 'facet add'.",
      })
      return 1
    }

    return 0
  },
}

/**
 * Discover installable adapters. If none, auto-launch the picker on
 * TTY; on non-TTY return null with a CLI error already written.
 */
async function ensureAdapters(): Promise<ReadonlyArray<Adapter> | null> {
  const adapters = await loadInstalledAdapters()
  const installable = adapters.filter((a) => a.supportsInstall === true)
  if (installable.length > 0) return installable

  if (adapters.length > 0) {
    const stale = adapters.map((a) => a.name).join(', ')
    writeCliError({
      what: `installed adapters do not support install yet: ${stale}`,
      detail: 'these adapters were bundled before install support shipped; the capability flag is missing',
      fix: "update each with 'facet adapter install <name>' to pull a version with install support",
    })
    return null
  }

  // Zero installable adapters. TTY → picker; non-TTY → fail.
  const result = await pickAndInstallAdapters()
  if (result.ok) {
    const installableAfter = result.adapters.filter((a) => a.supportsInstall === true)
    if (installableAfter.length === 0) {
      writeCliError({
        what: 'no adapters with install support after picker',
        detail: 'the selected adapter(s) bundled an old SDK without install support',
        fix: 'pick a different adapter or update one with install support',
      })
      return null
    }
    return installableAfter
  }

  if (result.reason === 'non-tty') {
    writeCliError({
      what: 'no adapters installed',
      detail: 'this is a non-interactive environment; the picker cannot run here',
      fix: "run 'facet adapter install <name>' first (e.g. claude-code, opencode)",
    })
  } else if (result.reason === 'aborted') {
    process.stderr.write('Aborted: no adapters installed.\n')
  }
  // 'install-failed': pickAndInstallAdapters wrote its own CLI error.
  return null
}

/**
 * Read the source's `facet.json` just far enough to learn the facet's
 * name. We do this here (not just inside runInstall) so the manifest
 * write step can use the correct name as the `facets.json` key.
 *
 * This duplicates a small slice of `runInstall.planFacet`'s work. The
 * alternative is to pass the user's specifier in as the key and let
 * the install fail with `MANIFEST_NAME_MISMATCH` after the manifest is
 * already on disk — uglier and harder to roll back from cleanly.
 */
async function peekFacetName(source: Source, specifier: string): Promise<string | null> {
  if (source.kind === 'registry') {
    // Registry source: the canonical name on the parsed source IS the
    // facet name (the registry keys by canonical name), so we can write
    // the manifest entry without a network round-trip. runInstall will
    // verify the manifest's declared name matches when it downloads.
    return source.name
  }
  const { loadManifest } = await import('@agent-facets/engine')
  let sourceDir: string
  let cleanup: (() => Promise<void>) | undefined
  if (source.kind === 'git') {
    const { cloneFacetGitSource } = await import('@agent-facets/engine')
    try {
      const cloned = await cloneFacetGitSource(source.url, source.ref)
      sourceDir = cloned.dir
      const { rm } = await import('node:fs/promises')
      cleanup = async () => {
        await rm(cloned.dir, { recursive: true, force: true }).catch(() => {})
      }
    } catch (err) {
      writeCliError({
        what: `could not clone git source "${specifier}"`,
        detail: err instanceof Error ? err.message : String(err),
        fix: 'verify the URL and your network connectivity',
      })
      return null
    }
  } else {
    const { resolveLocalFacetSource } = await import('@agent-facets/engine')
    const resolved = await resolveLocalFacetSource(source.path, process.cwd())
    if (!resolved.ok) {
      writeCliError({
        what: `could not resolve local source "${specifier}"`,
        detail: resolved.error,
        fix: 'check the path exists inside the project tree',
      })
      return null
    }
    sourceDir = resolved.dir
  }

  try {
    const manifest = await loadManifest(sourceDir)
    if (!manifest.ok) {
      writeCliError({
        what: `could not load facet.json from ${specifier}`,
        detail: manifest.errors.map((e) => e.message).join('; '),
        fix: 'verify the source is a facet directory with a valid facet.json',
      })
      return null
    }
    if (manifest.data.facets && manifest.data.facets.length > 0) {
      writeCliError({
        what: 'facet composition is not supported',
        detail: `${specifier} declares dependencies on other facets`,
        fix: 'use a non-composing facet, or wait until composition support ships',
      })
      return null
    }
    return manifest.data.name
  } finally {
    if (cleanup) await cleanup()
  }
}

function writeParseError(specifier: string, error: ParseError): void {
  writeCliError({
    what: `could not parse source "${specifier}"`,
    detail: error.what,
    fix: error.fix,
  })
}

function restoreSnapshot(path: string, snapshot: Buffer | null): void {
  if (snapshot === null) {
    if (existsSync(path)) rmSync(path)
    return
  }
  writeFileSync(path, snapshot)
}
