import { rm } from 'node:fs/promises'
import type { Command } from '../../commands.ts'
import { bundleAdapter } from './bundler.ts'
import { listInstalledAdapters, placeAdapter, removeAdapter } from './placement.ts'
import { cloneGitRepository } from './sources/git.ts'
import { resolveLocalPath } from './sources/local.ts'
import { downloadNpmPackage } from './sources/npm.ts'
import { parseSpecifier } from './specifier.ts'
import { verifyAdapter } from './verify.ts'

/**
 * `facet adapter` command — manages adapter installations.
 *
 * Subcommands:
 * - `facet adapter install <specifier>` — Install an adapter
 * - `facet adapter list` — List installed adapters
 * - `facet adapter remove <name>` — Remove an installed adapter
 */
export const adapterCommand: Command = {
  name: 'adapter',
  description: 'Manage adapter installations',
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
          console.error(`Unknown adapter subcommand "${subcommand}". Use install, list, or remove.`)
        } else {
          console.error('Usage: facet adapter <install|list|remove> [args]')
        }
        return 1
      }
    }
  },
}

async function handleInstall(args: string[]): Promise<number> {
  const specifier = args[0]
  if (!specifier) {
    console.error('Usage: facet adapter install <specifier>')
    console.error('')
    console.error('Specifier formats:')
    console.error('  opencode                    Built-in adapter name')
    console.error('  @scope/adapter-name         npm package')
    console.error('  git+https://repo.git        Git repository')
    console.error('  ./path/to/adapter           Local path')
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
    console.log('Bundling adapter...')
    const bundlePath = await bundleAdapter(sourceDir)

    // Step 3: Verify
    console.log('Verifying adapter...')
    const adapter = await verifyAdapter(bundlePath)

    // Step 4: Place
    console.log(`Installing adapter "${adapter.name}"...`)
    await placeAdapter(adapter.name, bundlePath)

    console.log(`Adapter "${adapter.name}" installed successfully.`)
    return 0
  } catch (err) {
    console.error(`Failed to install adapter: ${err instanceof Error ? err.message : String(err)}`)
    return 1
  } finally {
    // Clean up temp directory if needed
    if (needsCleanup && sourceDir) {
      await rm(sourceDir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

async function handleList(): Promise<number> {
  const names = await listInstalledAdapters()

  if (names.length === 0) {
    console.log('No adapters installed.')
    console.log('')
    console.log('Install one with: facet adapter install <specifier>')
    return 0
  }

  console.log('Installed adapters:')
  for (const name of names) {
    console.log(`  ${name}`)
  }
  return 0
}

async function handleRemove(args: string[]): Promise<number> {
  const name = args[0]
  if (!name) {
    console.error('Usage: facet adapter remove <name>')
    return 1
  }

  const removed = await removeAdapter(name)
  if (removed) {
    console.log(`Adapter "${name}" removed.`)
    return 0
  }

  console.error(`Adapter "${name}" is not installed.`)
  return 1
}
