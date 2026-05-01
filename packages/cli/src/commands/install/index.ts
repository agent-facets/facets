import { rm } from 'node:fs/promises'
import type { Adapter } from '@agent-facets/adapter'
import {
  acquireInstallLock,
  cloneFacetGitSource,
  computeAssetList,
  diffAssetsForDeletion,
  emptyLockfile,
  type FacetsJson,
  InstallJournal,
  type Lockfile,
  type LockfileAssetEntry,
  type LockfileFacet,
  loadFacetsJson,
  loadInstalledAdapters,
  loadLockfile,
  loadManifest,
  materialize,
  parseFacetSource,
  type ResolvedFacetManifest,
  resolveLocalFacetSource,
  resolvePrompts,
  runBuildPipeline,
  writeLockfile,
} from '@agent-facets/core'
import type { Command } from '../../commands.ts'
import { writeCliError } from '../../util/errors.ts'

/**
 * `facet install` — materialize all facets listed in facets.json into
 * selected adapters. Runs a journal so adapter-level errors (or SIGINT)
 * trigger best-effort rollback (Adjustment B).
 */
export const installCommand: Command = {
  name: 'install',
  description: 'Install all facets from facets.json',
  implemented: true,
  flags: {
    verbose: { type: 'boolean', description: 'Show detailed step output on stderr' },
    'dry-run': { type: 'boolean', description: 'Preview changes without writing' },
  },
  run: async (_args, flags) => {
    const verbose = flags.verbose === true
    const dryRun = flags['dry-run'] === true
    const onLog = (line: string) => {
      if (verbose) process.stderr.write(`${line}\n`)
    }

    const projectRoot = process.cwd()

    // ── Parse facets.json ─────────────────────────────────────────────
    onLog('[verbose] parse facets.json')
    const facetsJson = loadFacetsJson(projectRoot)
    if (!facetsJson.ok) {
      writeCliError({
        what: 'could not read facets.json',
        detail: facetsJson.error,
        fix: "run 'facet add <source>' to create one, or check you're in the right directory",
      })
      return 1
    }
    if (!facetsJson.existed) {
      writeCliError({
        what: `no facets.json in ${projectRoot}`,
        fix: "run 'facet add <source>' to create one, or check you're in the right directory",
      })
      return 1
    }

    // ── Load adapters and enforce supportsInstall ─────────────────────
    const allAdapters = await loadInstalledAdapters(undefined, {
      onWarn: (line) => console.error(line),
    })
    const adapters = allAdapters.filter((a) => a.supportsInstall === true)
    if (adapters.length === 0) {
      if (allAdapters.length > 0) {
        // Installed but stale — older versions predate the supportsInstall
        // capability flag. Be specific so partners know the install
        // pipeline is wired; they just have outdated bundles.
        const names = allAdapters.map((a) => a.name).join(', ')
        writeCliError({
          what: `installed adapters do not support install yet: ${names}`,
          detail: 'these adapters were bundled before install support shipped; the capability flag is missing',
          fix: `update each with 'facet adapter install <name>' to pull a version with install support`,
        })
        return 1
      }
      if (!process.stdout.isTTY) {
        writeCliError({
          what: 'no adapters installed',
          detail: 'this is a non-interactive environment; the picker cannot run here',
          fix: "run 'facet adapter install <name>' with an explicit adapter (e.g. claude-code, opencode)",
        })
        return 1
      }
      writeCliError({
        what: 'no adapters installed',
        detail: 'facet install requires at least one installed adapter to materialize assets',
        fix: "run 'facet adapter install' and pick which AI tools to connect",
      })
      return 1
    }

    // ── Acquire advisory install lock ─────────────────────────────────
    const lockResult = acquireInstallLock(projectRoot)
    if (!lockResult.ok) {
      writeCliError({
        what: `another facet install is running (pid ${lockResult.heldByPid})`,
        fix: `wait, or remove ${lockResult.path} if no other process is running`,
      })
      return 1
    }
    const installLock = lockResult.lock

    // ── Install-side SIGINT handler (Adjustment B) ────────────────────
    const journal = new InstallJournal()
    let interrupted = false
    const sigintHandler = () => {
      interrupted = true
      process.stderr.write('\nInterrupted. Rolling back…\n')
    }
    process.on('SIGINT', sigintHandler)

    try {
      // ── Load prior lockfile (or empty skeleton) ─────────────────────
      const lockfileLoad = loadLockfile(projectRoot)
      if (!lockfileLoad.ok) {
        writeCliError({
          what: lockfileLoad.error,
          fix: 'delete facets.lock and re-run facet install to regenerate',
        })
        return 1
      }
      const lockfile = lockfileLoad.existed ? lockfileLoad.data : emptyLockfile()

      // ── Dry-run branch: plan only, no writes ────────────────────────
      if (dryRun) {
        return await runDryRun({
          projectRoot,
          adapters,
          facetsJson: facetsJson.data,
          lockfile,
          onLog,
        })
      }

      const newFacetEntries: Record<string, LockfileFacet> = {}
      let totalAssets = 0

      for (const [facetName, specifier] of Object.entries(facetsJson.data.facets)) {
        const entry = await installFacet({
          facetName,
          specifier,
          projectRoot,
          adapters,
          previous: lockfile.facets[facetName],
          journal,
          onLog,
        })
        newFacetEntries[facetName] = entry
        totalAssets += entry.assets.length * adapters.length
      }

      // Drift fix — facets present in the prior lockfile but absent from
      // facets.json must have their assets deleted from every selected
      // adapter. Without this pass, removing a facet from facets.json would
      // orphan its materialized files forever (the lockfile entry gets
      // dropped below, so future installs have no record to clean up).
      let removedAssets = 0
      for (const [facetName, prevEntry] of Object.entries(lockfile.facets)) {
        if (facetName in facetsJson.data.facets) continue
        onLog(`[verbose] remove ${facetName} (no longer in facets.json)`)
        await removeFacet({
          adapters,
          previous: prevEntry,
          journal,
          onLog,
        })
        removedAssets += prevEntry.assets.length * adapters.length
      }

      if (interrupted) {
        throw new Error('install interrupted by user')
      }

      // Atomic lockfile write
      onLog('[verbose] write lockfile')
      writeLockfile(projectRoot, {
        lockfileVersion: lockfile.lockfileVersion,
        facets: newFacetEntries,
      })

      const facetCount = Object.keys(newFacetEntries).length
      const adapterNames = adapters.map((a) => a.name).join(', ')
      const restart =
        adapters.length === 1
          ? `  Restart ${adapters[0]?.name ?? 'your tooling'} to see your new assets.\n`
          : '  Restart your tooling to see your new assets.\n'

      if (facetCount === 0 && removedAssets > 0) {
        process.stdout.write(
          `✓ Removed ${removedAssets} asset${removedAssets !== 1 ? 's' : ''} from ${adapterNames}. facets.json is empty.\n`,
        )
      } else if (facetCount === 1) {
        const [only] = Object.entries(newFacetEntries)
        const removedSuffix =
          removedAssets > 0 ? ` ${removedAssets} asset${removedAssets !== 1 ? 's' : ''} removed.` : ''
        process.stdout.write(
          `✓ Installed ${only?.[0]}@${only?.[1].version} for ${adapterNames}. ${totalAssets} asset${totalAssets !== 1 ? 's' : ''} written.${removedSuffix}\n`,
        )
      } else {
        const names = Object.entries(newFacetEntries)
          .map(([n, e]) => `${n}@${e.version}`)
          .join(', ')
        const removedSuffix =
          removedAssets > 0 ? ` ${removedAssets} asset${removedAssets !== 1 ? 's' : ''} removed.` : ''
        process.stdout.write(
          `✓ Installed ${facetCount} facets (${names}) for ${adapterNames}. ${totalAssets} assets written.${removedSuffix}\n`,
        )
      }
      process.stdout.write(restart)
      return 0
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      process.stderr.write(`\nInstall failed: ${reason}\n`)
      const result = await journal.rollback({ onLog })
      if (!result.ok) {
        writeCliError({
          what: 'rollback failed mid-replay',
          detail: `${result.failures} inverse op${result.failures !== 1 ? 's' : ''} threw`,
          fix: "partial state on disk; re-run 'facet install' to attempt reconciliation",
        })
      } else {
        writeCliError({
          what: 'install failed',
          detail: reason,
          fix: "rollback complete; fix the underlying issue and re-run 'facet install'",
        })
      }
      return 1
    } finally {
      process.off('SIGINT', sigintHandler)
      await installLock.release()
    }
  },
}

interface DryRunArgs {
  projectRoot: string
  adapters: Adapter[]
  facetsJson: FacetsJson
  lockfile: Lockfile
  onLog: (line: string) => void
}

async function runDryRun(args: DryRunArgs): Promise<number> {
  const { projectRoot, adapters, facetsJson, lockfile, onLog } = args
  const sections: string[] = []
  let anyChanges = false

  for (const [facetName, specifier] of Object.entries(facetsJson.facets)) {
    const plan = await planFacet({
      facetName,
      specifier,
      projectRoot,
      adapters,
      previous: lockfile.facets[facetName],
      onLog,
    })
    const prev = lockfile.facets[facetName]
    const changed = !prev || !sameEntry(prev, plan.entry)
    if (!changed) continue
    anyChanges = true

    sections.push(`Would install ${facetName}@${plan.entry.version}:`)
    for (const adapter of adapters) {
      const listing = plan.entry.assets.map((a) => `${a.type}:${a.name}`).join(', ')
      const assetCount = plan.entry.assets.length
      sections.push(
        `  + ${adapter.name}: ${assetCount} asset${assetCount !== 1 ? 's' : ''}${listing ? ` (${listing})` : ''}`,
      )
    }
    const toDelete = diffAssetsForDeletion(prev?.assets ?? [], plan.entry.assets)
    if (toDelete.length > 0) {
      const listing = toDelete.map((a) => `${a.type}:${a.name}`).join(', ')
      sections.push(
        `Would delete from each adapter: ${toDelete.length} asset${toDelete.length !== 1 ? 's' : ''} (${listing})`,
      )
    } else {
      sections.push('Would delete: nothing.')
    }
  }

  // Mirror the install-time stale-facet cleanup pass in the dry-run output so
  // partners can preview removals before committing.
  for (const [facetName, prevEntry] of Object.entries(lockfile.facets)) {
    if (facetName in facetsJson.facets) continue
    anyChanges = true
    sections.push(`Would remove ${facetName} (no longer in facets.json):`)
    for (const adapter of adapters) {
      const listing = prevEntry.assets.map((a) => `${a.type}:${a.name}`).join(', ')
      const assetCount = prevEntry.assets.length
      sections.push(
        `  - ${adapter.name}: ${assetCount} asset${assetCount !== 1 ? 's' : ''}${listing ? ` (${listing})` : ''}`,
      )
    }
  }

  if (!anyChanges) {
    process.stdout.write('No changes. facets.lock is in sync with facets.json.\n')
    return 0
  }

  process.stdout.write(`${sections.join('\n')}\n\nDry run — no changes written. Run without --dry-run to apply.\n`)
  return 0
}

function sameEntry(a: LockfileFacet, b: LockfileFacet): boolean {
  if (a.source !== b.source) return false
  if (a.ref !== b.ref) return false
  if (a.commit !== b.commit) return false
  if (a.version !== b.version) return false
  if (a.integrity !== b.integrity) return false
  if (a.assets.length !== b.assets.length) return false
  const key = (x: LockfileAssetEntry) => `${x.scope}:${x.type}:${x.name}`
  const ak = a.assets.map(key).sort()
  const bk = b.assets.map(key).sort()
  return ak.every((k, i) => k === bk[i])
}

interface InstallFacetArgs {
  facetName: string
  specifier: string
  projectRoot: string
  adapters: Adapter[]
  previous: LockfileFacet | undefined
  journal: InstallJournal
  onLog: (line: string) => void
}

async function installFacet(args: InstallFacetArgs): Promise<LockfileFacet> {
  return withFacetPlan(args, async ({ plan, resolved }) => {
    const oldAssets = args.previous?.assets ?? []
    onLogAssetDiff(args.onLog, plan.entry.assets.length, oldAssets.length, args.adapters)
    for (const adapter of args.adapters) {
      args.onLog(`[verbose] install for ${adapter.name}`)
    }
    await materialize({
      manifest: resolved,
      adapters: args.adapters,
      oldAssets,
      newAssets: plan.entry.assets,
      journal: args.journal,
      onLog: args.onLog,
    })
    return plan.entry
  })
}

interface RemoveFacetArgs {
  adapters: Adapter[]
  previous: LockfileFacet
  journal: InstallJournal
  onLog: (line: string) => void
}

/**
 * Remove all assets a facet previously contributed, across every selected
 * adapter. Used when a facet has been dropped from facets.json since the
 * last install — the materialize helper handles the per-asset journal
 * bookkeeping so rollback works the same way as a failed install.
 */
async function removeFacet(args: RemoveFacetArgs): Promise<void> {
  // materialize() treats newAssets=[] as "delete everything in oldAssets
  // from each adapter" via diffAssetsForDeletion. Passing an empty manifest
  // stand-in is safe because the delete branch only reads asset identity.
  await materialize({
    manifest: { name: '__removed__', version: '0.0.0', skills: {}, agents: {}, commands: {} },
    adapters: args.adapters,
    oldAssets: args.previous.assets,
    newAssets: [],
    journal: args.journal,
    onLog: args.onLog,
  })
}

interface PlanFacetArgs {
  facetName: string
  specifier: string
  projectRoot: string
  adapters: Adapter[]
  previous: LockfileFacet | undefined
  onLog: (line: string) => void
}

/**
 * Plan (but don't materialize) what a `facet install` would do for a single
 * facet. Extracted from `installFacet` so dry-run can share the same
 * resolve → build → diff pipeline without touching adapter I/O.
 */
async function planFacet(args: PlanFacetArgs): Promise<{ entry: LockfileFacet }> {
  return withFacetPlan({ ...args, journal: new InstallJournal() }, async ({ plan }) => ({ entry: plan.entry }))
}

async function withFacetPlan<T>(
  args: InstallFacetArgs,
  continuation: (ctx: { plan: { entry: LockfileFacet }; resolved: ResolvedFacetManifest }) => Promise<T>,
): Promise<T> {
  const { facetName, specifier, projectRoot, adapters, onLog } = args

  onLog(`[verbose] resolve ${facetName}@${specifier}`)
  const parsed = parseFacetSource(specifier)
  if (!parsed.ok) {
    throw new Error(`could not parse source "${specifier}": ${parsed.error}`)
  }

  let sourceDir: string
  let cleanup: (() => Promise<void>) | undefined
  let ref: string | undefined
  let commit: string | undefined

  if (parsed.data.type === 'git') {
    const cloned = await cloneFacetGitSource(parsed.data.url, parsed.data.commitish)
    sourceDir = cloned.dir
    cleanup = async () => {
      await rm(cloned.dir, { recursive: true, force: true }).catch(() => {})
    }
    ref = parsed.data.commitish
    commit = cloned.commit
    onLog(`[verbose]   cloned ${parsed.data.url} → ${sourceDir} (sha: ${commit ?? '?'})`)
  } else {
    const local = await resolveLocalFacetSource(parsed.data.path, projectRoot)
    if (!local.ok) throw new Error(local.error)
    sourceDir = local.dir
  }

  try {
    const rawManifest = await loadManifest(sourceDir)
    if (!rawManifest.ok) {
      throw new Error(
        `could not load facet.json from ${specifier}: ${rawManifest.errors.map((e) => e.message).join('; ')}`,
      )
    }
    if (rawManifest.data.name !== facetName) {
      throw new Error(
        `facets.json key "${facetName}" does not match facet.json name "${rawManifest.data.name}" in the source`,
      )
    }
    if (rawManifest.data.facets || rawManifest.data.servers) {
      throw new Error(
        `${specifier}: facet composition ('facets' or 'servers' in facet.json) is not supported in closed alpha`,
      )
    }

    onLog('[verbose] fetch artifact')
    const buildResult = await runBuildPipeline(sourceDir, adapters)
    if (!buildResult.ok) {
      throw new Error(`build failed for ${facetName}: ${buildResult.errors.map((e) => e.message).join('; ')}`)
    }
    onLog(`[verbose]   integrity ok: ${buildResult.integrity}`)

    const resolved = await resolvePrompts(rawManifest.data, sourceDir)
    if (!resolved.ok) {
      throw new Error(`prompt resolution failed: ${resolved.errors.map((e) => e.message).join('; ')}`)
    }

    const newAssets = computeAssetList(resolved.data)

    const entry: LockfileFacet = {
      source: specifier,
      ...(ref !== undefined ? { ref } : {}),
      ...(commit !== undefined ? { commit } : {}),
      version: buildResult.data.version,
      integrity: buildResult.integrity,
      assets: newAssets,
    }

    return await continuation({
      plan: { entry },
      resolved: resolved.data,
    })
  } finally {
    if (cleanup) await cleanup()
  }
}

function onLogAssetDiff(onLog: (line: string) => void, newCount: number, oldCount: number, adapters: Adapter[]): void {
  onLog(
    `[verbose] diff: +${newCount} -${Math.max(0, oldCount - newCount)} across ${adapters.length} adapter${adapters.length !== 1 ? 's' : ''}`,
  )
}
