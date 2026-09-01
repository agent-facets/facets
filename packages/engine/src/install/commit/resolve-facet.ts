import type { Adapter } from '@agent-facets/adapter'
import type { SupportedLockfile, SupportedLockfileFacet } from '@agent-facets/protocol'
import { describeVersionSpec } from '../../registry/describe.ts'
import type { Source } from '../../sources/facet/types.ts'
import { ownEntry } from '../own-entry.ts'
import { parseManifestFacetSource } from '../parse-manifest-source.ts'
import type { OnLog, StageEvent } from '../types.ts'
import type { FacetResolutionIntent } from './delta.ts'
import { resolveEffectiveLocked } from './effective-locked.ts'
import { resolveGitFacet } from './resolve-git.ts'
import { resolveLocalFacet } from './resolve-local.ts'
import { type RegistryVersionSource, resolveRegistryFacet } from './resolve-registry.ts'
import type { ResolveFacetResult } from './types.ts'

export interface ResolveFacetArgs {
  facetName: string
  specifier: string
  projectRoot: string
  adapters: ReadonlyArray<Adapter>
  previousLockfile: SupportedLockfile
  intent: FacetResolutionIntent
  frozenLockfile: boolean
  onStage: (event: StageEvent) => void
  onLog: OnLog
}

/**
 * Per-facet commit-phase resolution: parse → structural discriminator →
 * kind-dispatch to the source resolvers.
 *
 * The manifest is a `name → value` map. For a registry source the value
 * is a bare version specifier (`1.2.3`, `1.*`, `*`, `latest`) and the
 * facet name lives in the KEY — so when the value parses as a bare
 * VersionSpec we reconstruct the full source as `${facetName}@${value}`.
 * For git/local sources the value is a self-contained source string
 * (URL, `file:` path) and the key is just a label; we parse the value
 * standalone. This keeps `facets.json` values semver-shaped for registry
 * entries (the value the user sees is `1.2.3`, not `cowsay@1.2.3`) while
 * still round-tripping through source resolution.
 */
/**
 * Which of the four ways of knowing a registry facet's exact version
 * applies here.
 *
 * The order is the precedence: a reviewed update already has its answer,
 * an anchor supplies one without the network, an exact specifier needs
 * no resolution, and anything else has to ask.
 */
function registryVersionSource(
  intent: FacetResolutionIntent,
  effectiveLocked: SupportedLockfileFacet | undefined,
  source: Extract<Source, { kind: 'registry' }>,
): RegistryVersionSource {
  if (intent.kind === 'prepared') return { kind: 'prepared', metadata: intent.metadata }
  if (effectiveLocked !== undefined) return { kind: 'locked', entry: effectiveLocked }
  if (source.version.kind === 'exact') return { kind: 'exact', version: describeVersionSpec(source.version) }
  return { kind: 'resolve', spec: source.version }
}

export async function resolveFacet(args: ResolveFacetArgs): Promise<ResolveFacetResult> {
  const { facetName, specifier, projectRoot, adapters, frozenLockfile, onStage, onLog } = args

  onStage({ kind: 'facet-stage', facet: facetName, stage: 'parse' })
  const parsed = parseManifestFacetSource(facetName, specifier)
  if (!parsed.ok) {
    return {
      ok: false,
      failure: { code: 'PARSE_ERROR', facet: facetName, specifier, error: parsed.error },
    }
  }
  const source = parsed.value

  // The structural discriminator + staleness rules live in one place;
  // a cleared entry makes the facet resolve like a fresh add. Read own-only:
  // `constructor` is a legal facet name, and an indexed read of it on a
  // lockfile without that entry returns `Object` — not "absent", so the facet
  // resolves as anchored to an entry with no version, and `parseLockedVersion`
  // throws out of a function that promises to return failures.
  const effectiveLocked = resolveEffectiveLocked({
    locked: ownEntry(args.previousLockfile.facets, facetName),
    source,
    intent: args.intent,
  })

  switch (source.kind) {
    case 'registry':
      // Registry and git resolution do not vary by frozen mode: both always
      // verify resolved content against the locked integrity when a locked
      // entry anchors the facet. Only local sources gain an extra
      // reproduction guard under frozen, because a local tree is mutable by
      // design and a normal install lets the lockfile follow disk.
      return resolveRegistryFacet({
        facetName,
        source,
        version: registryVersionSource(args.intent, effectiveLocked, source),
        onStage,
        onLog,
      })
    case 'git':
      return resolveGitFacet({ facetName, source, adapters, effectiveLocked, onStage, onLog })
    case 'local':
      return resolveLocalFacet({
        facetName,
        source,
        projectRoot,
        adapters,
        effectiveLocked,
        frozenLockfile,
        onStage,
        onLog,
      })
  }
}
