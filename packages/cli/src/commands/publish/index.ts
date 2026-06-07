import {
  createRegistryClient,
  detectManifestDrift,
  discoverBuiltArtifacts,
  loadManifest,
  publishFacetVersion,
  resolveCredential,
  uncappedGunzip,
} from '@agent-facets/engine'
import { type FacetManifest, validateFacetArchive } from '@agent-facets/protocol'
import type { Command } from '../../commands.ts'
import { writeCliError } from '../../util/errors.ts'
import { translateEngineRegistryError } from '../../util/registry-errors.ts'
import { resolveTargetDir } from '../resolve-dir.ts'
import { askIdentityDriftDecision, askToBuildMissing, askToRebuildDrifted } from './build-offer.ts'
import { runBuildViewAndCapture } from './run-build-view.ts'

/**
 * `facet publish [directory]` — verify a previously-built `.facet`
 * archive in the project's `dist/` and POST it to the registry. The
 * directory defaults to the current working directory; pass a path to
 * publish a facet elsewhere (consistent with `build`, `edit`, and
 * `create`).
 *
 * Publish is a verify-and-ship step, not a build. `facet build` is the
 * sole producer of the `.facet` archive on disk. Publish discovers the
 * built artifact under `dist/`, verifies it against the artifact
 * specification, and uploads it. The build pipeline is invoked only on
 * explicit user-driven build-offer branches:
 *
 *   - **No built artifact at all.** TTY: offer to build current source
 *     and publish. Non-TTY: fail with "run `facet build` first."
 *   - **Content drift** (same name + version, different content).
 *     TTY: two-option offer — rebuild and publish, or publish existing
 *     as-is. Non-TTY: warn and ship existing.
 *   - **Identity drift** (different name or version). TTY: three-option
 *     offer — build & publish the current source, publish the existing
 *     artifact under its own identity, or cancel. Non-TTY: warn and
 *     ship existing.
 *
 * The address (`name`/`version`) used to POST the upload is always read
 * from the verified artifact's embedded manifests — never from a
 * separate parse of the source-tree `facet.json` — so the artifact's
 * own identity is always what reaches the registry.
 */
export const publishCommand: Command = {
  name: 'publish',
  description: 'Publish a facet to the registry',
  usage: '[directory]',
  implemented: true,
  run: async (args, _flags) => {
    // (a) Resolve target directory.
    const resolved = await resolveTargetDir(args[0], { mustExist: true, facetMustExist: true })
    if (!resolved.ok) {
      writeCliError({
        what: resolved.message,
        fix: 'pass a directory containing facet.json, or run `facet create` to scaffold one',
      })
      return 1
    }
    const projectRoot = resolved.dir

    // (b) Resolve credential before any work — fail fast.
    const cred = resolveCredential()
    if (cred.source === 'absent') {
      if (cred.reason?.code === 'unreadable') {
        writeCliError({
          what: "couldn't read your registry credentials file",
          detail: `${cred.reason.path}: ${cred.reason.cause}`,
          fix: "fix the file's permissions, or run `facet logout` then `facet login`",
        })
        return 1
      }
      writeCliError({
        what: 'not signed in — no registry credential found',
        fix: 'run `facet login` to sign in, or set FACET_TOKEN in your environment',
      })
      return 1
    }

    // (c) Load + validate the source-tree facet.json.
    const sourceManifestResult = await loadManifest(projectRoot)
    if (!sourceManifestResult.ok) {
      writeCliError({
        what: 'facet.json is invalid',
        detail: sourceManifestResult.errors.map((e) => `${e.path ? `${e.path}: ` : ''}${e.message}`).join('\n'),
        fix: 'fix facet.json and try again',
      })
      return 1
    }
    const sourceManifest = sourceManifestResult.data

    // (d) Discover what's in dist/.
    const discovery = await discoverBuiltArtifacts(projectRoot)
    if (discovery.state === 'multiple') {
      writeCliError({
        what: `multiple .facet files in dist/ — publish cannot choose between them`,
        detail: discovery.paths.join('\n'),
        fix: 'run `facet build` to prune dist/, or remove the extras manually',
      })
      return 1
    }

    // (e) Pick the bytes to publish, based on what's in dist/ and how
    //     it relates to the current source. discovery is narrowed to
    //     'none' | 'single' at this point — the 'multiple' branch
    //     above already returned.
    const distBytes = await pickBytesToPublish(discovery, sourceManifest, projectRoot)
    if (distBytes === null) {
      // The picker emitted any required user-facing message and chose
      // to abort. Exit non-zero.
      return 1
    }

    // (f) Verify the final bytes we're about to upload. Invariant:
    //     every set of bytes that reaches the registry was verified
    //     immediately before upload, in this exact spot. The picker
    //     may verify earlier for drift purposes; we re-verify here so
    //     the contract holds uniformly across all branches.
    const verified = await validateFacetArchive(distBytes, { gunzip: uncappedGunzip })
    if (!verified.ok) {
      writeCliError({
        what: 'built artifact failed verification',
        detail: verified.errors.map((e) => `${e.path}: ${e.message}`).join('\n'),
        fix: 'rebuild with `facet build`',
      })
      return 1
    }
    const { facetManifest } = verified.data

    // (g) Upload using the artifact's embedded identity.
    const client = createRegistryClient({ credential: cred.token })
    const result = await publishFacetVersion(client, {
      name: facetManifest.name,
      tarball: distBytes,
    })

    if (!result.ok) {
      writeCliError(translateEngineRegistryError(result.error))
      return 1
    }

    if (result.value.kind === 'queued') {
      process.stdout.write(`${facetManifest.name}@${facetManifest.version} was submitted for review.\n`)
      process.stdout.write(`${result.value.queued.fix}\n`)
      return 0
    }

    process.stdout.write(`Published ${facetManifest.name}@${facetManifest.version}.\n`)
    return 0
  },
}

/**
 * Choose the bytes to publish based on what's in `dist/` and the
 * current source manifest. Returns `null` if the user (or non-TTY
 * fallback) chose to abort; the caller exits non-zero.
 *
 * Branches:
 *   - No artifact found    → "no built artifact" prompt or non-TTY fail.
 *   - Artifact, in sync    → return its bytes directly.
 *   - Artifact, content drift  → two-option content-drift prompt or non-TTY warn-and-ship.
 *   - Artifact, identity drift → three-option identity-drift prompt or non-TTY warn-and-ship.
 *
 * On a build-or-rebuild branch this function mounts `<BuildView>`,
 * re-reads the freshly written `dist/` artifact, and returns those
 * bytes. The build view drives its own user-facing rendering; failures
 * surface as `null` and the build view has already explained itself.
 */
async function pickBytesToPublish(
  discovery: { state: 'none' } | { state: 'single'; path: string },
  sourceManifest: FacetManifest,
  projectRoot: string,
): Promise<Uint8Array | null> {
  // === No artifact present ===
  if (discovery.state === 'none') {
    if (!process.stdout.isTTY) {
      writeCliError({
        what: 'no built artifact in dist/',
        fix: 'run `facet build` first, then `facet publish`',
      })
      return null
    }
    const accepted = await askToBuildMissing()
    if (!accepted) {
      writeCliError({
        what: 'nothing to publish — no built artifact',
        fix: 'run `facet build`, then `facet publish` again',
      })
      return null
    }
    return await buildAndReadFreshArtifact(projectRoot, sourceManifest)
  }

  // === Single artifact present — read, verify, compare to source ===
  const existingBytes = await readBytes(discovery.path)
  const verifyForDrift = await validateFacetArchive(existingBytes, { gunzip: uncappedGunzip })
  if (!verifyForDrift.ok) {
    writeCliError({
      what: 'built artifact failed verification',
      detail: verifyForDrift.errors.map((e) => `${e.path}: ${e.message}`).join('\n'),
      fix: 'rebuild with `facet build`',
    })
    return null
  }
  const embedded = verifyForDrift.data.facetManifest
  const drift = detectManifestDrift(sourceManifest, embedded)

  // No drift: ship the existing bytes as-is.
  if (drift.inSync) {
    return existingBytes
  }

  // === Drift detected — route on identity vs. content ===
  const isIdentityDrift = drift.reason === 'name' || drift.reason === 'version'

  // Non-interactive: warn to stderr, ship existing.
  if (!process.stdout.isTTY) {
    const summary = isIdentityDrift
      ? `built artifact is ${embedded.name}@${embedded.version}; source is ${sourceManifest.name}@${sourceManifest.version}`
      : `built artifact is out of date (manifest content differs from source)`
    process.stderr.write(
      `warning: ${summary}; shipping the existing artifact unchanged.\n` +
        `run \`facet build\` before \`facet publish\` if you want the current source published.\n`,
    )
    return existingBytes
  }

  // Interactive — content drift gets the two-option prompt.
  if (!isIdentityDrift) {
    const rebuild = await askToRebuildDrifted()
    if (!rebuild) return existingBytes
    return await buildAndReadFreshArtifact(projectRoot, sourceManifest)
  }

  // Interactive — identity drift gets the three-option prompt.
  const decision = await askIdentityDriftDecision(
    { name: sourceManifest.name, version: sourceManifest.version },
    { name: embedded.name, version: embedded.version },
  )
  if (decision === 'cancel') {
    writeCliError({
      what: 'publish cancelled',
      fix: 'run `facet publish` again when you have decided',
    })
    return null
  }
  if (decision === 'ship-existing') {
    return existingBytes
  }
  // decision === 'build-new'
  return await buildAndReadFreshArtifact(projectRoot, sourceManifest)
}

/**
 * Run the build view (mounting Ink), then re-read the freshly written
 * artifact from `dist/`. Returns `null` if the build failed (the build
 * view has already rendered the failure) or if the expected output
 * file is missing for any reason.
 */
async function buildAndReadFreshArtifact(
  projectRoot: string,
  sourceManifest: FacetManifest,
): Promise<Uint8Array | null> {
  const built = await runBuildViewAndCapture(projectRoot)
  if (!built.ok) return null

  // `writeBuildOutput` purges dist/ and writes exactly
  // `dist/<name>-<version>.facet`. Re-discover (rather than computing
  // the path from sourceManifest) so the post-build view of dist/ is
  // the same shape publish reads everywhere else.
  const post = await discoverBuiltArtifacts(projectRoot)
  if (post.state !== 'single') {
    writeCliError({
      what: 'build succeeded but the built artifact is missing or ambiguous',
      detail:
        post.state === 'none'
          ? `expected one .facet in dist/${sourceManifest.name}-${sourceManifest.version}.facet`
          : `multiple .facet files: ${post.paths.join(', ')}`,
      fix: 'this is likely a bug; please report it',
    })
    return null
  }
  return readBytes(post.path)
}

async function readBytes(path: string): Promise<Uint8Array> {
  return new Uint8Array(await Bun.file(path).bytes())
}
