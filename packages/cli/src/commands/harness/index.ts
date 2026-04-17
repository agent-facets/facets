import { rm } from 'node:fs/promises'
import type { Command } from '../../commands.ts'
import { bundleHarness } from './bundler.ts'
import { listInstalledHarnesses, placeHarness, removeHarness } from './placement.ts'
import { cloneGitRepository } from './sources/git.ts'
import { resolveLocalPath } from './sources/local.ts'
import { downloadNpmPackage } from './sources/npm.ts'
import { parseSpecifier } from './specifier.ts'
import { verifyHarness } from './verify.ts'

/**
 * `facet harness` command — manages harness installations.
 *
 * Subcommands:
 * - `facet harness install <specifier>` — Install a harness
 * - `facet harness list` — List installed harnesses
 * - `facet harness remove <name>` — Remove an installed harness
 */
export const harnessCommand: Command = {
  name: 'harness',
  description: 'Manage harness installations',
  usage: '<install|list|remove> [args]',

  async run(args, _flags) {
    const subcommand = args[0]

    switch (subcommand) {
      case 'install':
        return handleInstall(args.slice(1))
      case 'list':
        return handleList()
      case 'remove':
        return handleRemove(args.slice(1))
      default: {
        if (subcommand) {
          console.error(`Unknown harness subcommand "${subcommand}". Use install, list, or remove.`)
        } else {
          console.error('Usage: facet harness <install|list|remove> [args]')
        }
        return 1
      }
    }
  },
}

async function handleInstall(args: string[]): Promise<number> {
  const specifier = args[0]
  if (!specifier) {
    console.error('Usage: facet harness install <specifier>')
    console.error('')
    console.error('Specifier formats:')
    console.error('  opencode                    Built-in harness name')
    console.error('  @scope/harness-name         npm package')
    console.error('  git+https://repo.git        Git repository')
    console.error('  ./path/to/harness           Local path')
    return 1
  }

  const resolved = parseSpecifier(specifier)
  let sourceDir: string | undefined
  let needsCleanup = true

  try {
    // Step 1: Resolve source
    console.log(`Resolving "${specifier}"...`)

    switch (resolved.type) {
      case 'npm':
        console.log(`Downloading ${resolved.packageName} from npm...`)
        sourceDir = await downloadNpmPackage(resolved.packageName)
        break
      case 'git':
        console.log(`Cloning ${resolved.url}...`)
        sourceDir = await cloneGitRepository(resolved.url, resolved.commitish)
        break
      case 'local':
        sourceDir = await resolveLocalPath(resolved.path)
        needsCleanup = false // Don't delete user's local directory
        break
    }

    // Step 2: Bundle
    console.log('Bundling harness...')
    const bundlePath = await bundleHarness(sourceDir)

    // Step 3: Verify
    console.log('Verifying harness...')
    const harness = await verifyHarness(bundlePath)

    // Step 4: Place
    console.log(`Installing harness "${harness.name}"...`)
    await placeHarness(harness.name, bundlePath)

    console.log(`Harness "${harness.name}" installed successfully.`)
    return 0
  } catch (err) {
    console.error(`Failed to install harness: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  } finally {
    // Clean up temp directory if needed
    if (needsCleanup && sourceDir) {
      await rm(sourceDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

async function handleList(): Promise<number> {
  const names = await listInstalledHarnesses()

  if (names.length === 0) {
    console.log('No harnesses installed.')
    console.log('')
    console.log('Install one with: facet harness install <specifier>')
    return 0
  }

  console.log('Installed harnesses:')
  for (const name of names) {
    console.log(`  ${name}`)
  }
  return 0
}

async function handleRemove(args: string[]): Promise<number> {
  const name = args[0]
  if (!name) {
    console.error('Usage: facet harness remove <name>')
    return 1
  }

  const removed = await removeHarness(name)
  if (removed) {
    console.log(`Harness "${name}" removed.`)
    return 0
  }

  console.error(`Harness "${name}" is not installed.`)
  return 1
}
