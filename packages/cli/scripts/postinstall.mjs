/**
 * Postinstall script for agent-facets.
 *
 * Detects the current platform, architecture, AVX2 support, and musl libc,
 * then hard-links the optimal binary to bin/.facet for fast launcher resolution.
 *
 * Silent failure — if anything goes wrong, the launcher's fallback logic handles it.
 */

import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, unlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { arch as osArch, platform as osPlatform } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------

function detectPlatform() {
  const platformMap = { darwin: 'darwin', linux: 'linux', win32: 'windows' }
  const archMap = { x64: 'x64', arm64: 'arm64', arm: 'arm' }
  const platform = platformMap[osPlatform()] || osPlatform()
  const arch = archMap[osArch()] || osArch()
  return { platform, arch }
}

// ---------------------------------------------------------------------------
// AVX2 detection
// ---------------------------------------------------------------------------

function supportsAvx2(platform) {
  if (platform === 'linux') {
    try {
      return /(^|\s)avx2(\s|$)/i.test(readFileSync('/proc/cpuinfo', 'utf8'))
    } catch {
      return false
    }
  }

  if (platform === 'darwin') {
    try {
      const result = spawnSync('sysctl', ['-n', 'hw.optional.avx2_0'], {
        encoding: 'utf8',
        timeout: 1500,
      })
      if (result.status !== 0) return false
      return (result.stdout || '').trim() === '1'
    } catch {
      return false
    }
  }

  if (platform === 'windows') {
    const cmd =
      '(Add-Type -MemberDefinition "[DllImport(""kernel32.dll"")] public static extern bool IsProcessorFeaturePresent(int ProcessorFeature);" -Name Kernel32 -Namespace Win32 -PassThru)::IsProcessorFeaturePresent(40)'

    for (const exe of ['powershell.exe', 'pwsh.exe', 'pwsh', 'powershell']) {
      try {
        const result = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', cmd], {
          encoding: 'utf8',
          timeout: 3000,
          windowsHide: true,
        })
        if (result.status !== 0) continue
        const out = (result.stdout || '').trim().toLowerCase()
        if (out === 'true' || out === '1') return true
        if (out === 'false' || out === '0') return false
      } catch {}
    }
    return false
  }

  return false
}

// ---------------------------------------------------------------------------
// musl detection (Linux only)
// ---------------------------------------------------------------------------

function isMusl() {
  try {
    if (existsSync('/etc/alpine-release')) return true
  } catch {
    // ignore
  }

  try {
    const result = spawnSync('ldd', ['--version'], { encoding: 'utf8' })
    const text = ((result.stdout || '') + (result.stderr || '')).toLowerCase()
    if (text.includes('musl')) return true
  } catch {
    // ignore
  }

  return false
}

// ---------------------------------------------------------------------------
// Build priority-ordered candidate list
// ---------------------------------------------------------------------------

function buildCandidates(platform, arch, opts = {}) {
  const base = `@agent-facets/cli-${platform}-${arch}`
  const avx2 = opts.avx2 !== undefined ? opts.avx2 : arch === 'x64' ? supportsAvx2(platform) : false
  const baseline = arch === 'x64' && !avx2

  if (platform === 'linux') {
    const musl = opts.musl !== undefined ? opts.musl : isMusl()

    if (musl) {
      if (arch === 'x64') {
        if (baseline) return [`${base}-baseline-musl`, `${base}-musl`, `${base}-baseline`, base]
        return [`${base}-musl`, `${base}-baseline-musl`, base, `${base}-baseline`]
      }
      return [`${base}-musl`, base]
    }

    if (arch === 'x64') {
      if (baseline) return [`${base}-baseline`, base, `${base}-baseline-musl`, `${base}-musl`]
      return [base, `${base}-baseline`, `${base}-musl`, `${base}-baseline-musl`]
    }
    return [base, `${base}-musl`]
  }

  if (arch === 'x64') {
    if (baseline) return [`${base}-baseline`, base]
    return [base, `${base}-baseline`]
  }
  return [base]
}

// ---------------------------------------------------------------------------
// Find the binary via require.resolve
// ---------------------------------------------------------------------------

function findBinary(candidates) {
  const binaryName = osPlatform() === 'win32' ? 'facet.exe' : 'facet'

  for (const candidate of candidates) {
    try {
      const pkgPath = require.resolve(`${candidate}/package.json`)
      const pkgDir = dirname(pkgPath)
      const binaryPath = join(pkgDir, 'bin', binaryName)
      if (existsSync(binaryPath)) return binaryPath
    } catch {
      // Package not installed — try next candidate
    }
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  // Windows: no-op — the .exe is used directly
  if (osPlatform() === 'win32') return

  const { platform, arch } = detectPlatform()
  const candidates = buildCandidates(platform, arch)
  const binaryPath = findBinary(candidates)

  if (!binaryPath) return // No binary found — launcher fallback handles it

  const binDir = join(__dirname, '..', 'bin')
  const targetPath = join(binDir, '.facet')

  // Ensure bin directory exists
  mkdirSync(binDir, { recursive: true })

  // Remove existing cached binary
  try {
    unlinkSync(targetPath)
  } catch {
    // Doesn't exist — fine
  }

  // Hard-link (copy fallback on cross-device)
  try {
    linkSync(binaryPath, targetPath)
  } catch {
    copyFileSync(binaryPath, targetPath)
  }

  chmodSync(targetPath, 0o755)
}

// Guard: only run main() when executed directly, not when imported by tests
const scriptPath = fileURLToPath(import.meta.url)
const isDirectExecution = process.argv[1] && resolve(process.argv[1]) === scriptPath

if (isDirectExecution) {
  try {
    main()
  } catch (e) {
    // Log the error but exit 0 — launcher fallback will handle binary resolution.
    // We don't want a postinstall failure to break `npm install`.
    console.error('[agent-facets postinstall] failed to cache platform binary:', e.message || e)
  }
}

// Exports for testing — these are no-ops when run as a script
export { buildCandidates, detectPlatform }
