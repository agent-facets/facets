import { describe, expect, test } from 'bun:test'
import { closeSync, fstatSync, mkdtempSync, openSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type DarwinDirectoryAclResult, inspectDarwinDirectoryAcl } from '../oauth-permissions'

const helper = new URL('../oauth-permissions.ts', import.meta.url).pathname
const unavailable: DarwinDirectoryAclResult = { ok: false, reason: 'acl-unavailable' }

function run(argv: string[], cwd: string) {
  const child = Bun.spawnSync(argv, { cwd, stdout: 'pipe', stderr: 'pipe', timeout: 60_000 })
  expect({ exit: child.exitCode, stderr: child.stderr.toString(), stdout: child.stdout.toString() }).toEqual({
    exit: 0,
    stderr: expect.any(String),
    stdout: expect.stringContaining('verified'),
  })
}

const nativeFixture = `
import assert from 'node:assert/strict'
import { constants, closeSync, fstatSync, mkdirSync, mkdtempSync, openSync, rmSync } from 'node:fs'
import { homedir, tmpdir, userInfo } from 'node:os'
import { join } from 'node:path'
import { inspectDarwinDirectoryAcl } from ${JSON.stringify(helper)}
const root = mkdtempSync(join(tmpdir(), 'oauth-acl-native-'))
function chmod(...args) {
  const child = Bun.spawnSync(['/bin/chmod', ...args], { timeout: 5000 })
  assert.equal(child.exitCode, 0, child.stderr.toString())
}
try {
  const cases = [
    ['absent', [], true],
    ['deny', ['everyone deny delete'], true],
    ['grant', ['everyone allow delete,delete_child,search'], false],
    ['inherit-only', ['everyone allow delete,delete_child,directory_inherit,only_inherit'], false],
    ['mixed', ['everyone deny delete', 'everyone allow delete_child'], false],
    ['owner-grant', ['user:' + userInfo().username + ' allow delete_child'], false],
  ]
  const inheritedParent = join(root, 'inherited-parent')
  mkdirSync(inheritedParent)
  chmod('+a', 'everyone allow delete,delete_child,directory_inherit', inheritedParent)
  const inherited = join(inheritedParent, 'child')
  mkdirSync(inherited)
  const paths = [[homedir(), true], [inherited, false]]
  for (const [name, entries, safe] of cases) {
    const path = join(root, name)
    mkdirSync(path, { mode: 0o700 })
    chmod('-N', path)
    for (const entry of entries) chmod('+a', entry, path)
    paths.push([path, safe])
  }
  for (const [path, safe] of paths) {
    const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    try {
      for (let i = 0; i < 50; i++) {
        assert.deepEqual(inspectDarwinDirectoryAcl(fd), safe ? { ok: true } : { ok: false, reason: 'unsafe-acl' }, path)
        Bun.gc(true)
      }
      assert.equal(fstatSync(fd).isDirectory(), true)
    } finally { closeSync(fd) }
  }
  console.log('verified native ' + process.arch + ' Bun ' + Bun.version)
} finally { chmod('-RN', root); rmSync(root, { recursive: true, force: true }) }
`

const mockedFixture = `
import { mock } from 'bun:test'
import { createRequire } from 'node:module'
import assert from 'node:assert/strict'
import { closeSync, fstatSync, openSync } from 'node:fs'
const scenario = process.argv[2]
let freed = 0, loaded = 0, entered = 0, last = ''
if (scenario === 'non-darwin') Object.defineProperty(process, 'platform', { value: 'linux' })
const native = {
  os: { errno: { ENOENT: 2, EINVAL: 22 } },
  errno() {
    if (scenario === 'errno-throw') throw Error('native details')
    if (scenario === 'errno-malformed') return '22'
    return last === 'get' ? (scenario === 'absent' ? 2 : 9) : (scenario === 'entry-failure' ? 9 : 22)
  },
  load() {
    loaded++
    if (scenario === 'load-failure') throw Error('private loader details')
    return { func(definition) {
      if (scenario === 'binding-failure') throw Error('binding')
      if (definition.includes('acl_get_fd_np')) return () => {
        last = 'get'
        if (scenario === 'get-throw') throw Error('get')
        if (['absent', 'get-failure'].includes(scenario)) return null
        if (scenario === 'pointer-malformed') return 123
        if (scenario === 'pointer-zero') return 0n
        return 123n
      }
      if (definition.includes('acl_valid')) return () => scenario === 'invalid-acl' ? -1 : scenario === 'valid-malformed' ? '0' : 0
      if (definition.includes('acl_get_entry')) return (acl, id, out) => {
        assert.equal(acl, 123n)
        assert.equal(id, entered++ === 0 ? 0 : -1)
        last = 'entry'
        if (scenario === 'entry-throw') throw Error('entry')
        if (scenario === 'entry-malformed') return '0'
        if (scenario === 'entry-positive') return 1
        if (scenario === 'entry-failure' || (entered > 1 && scenario !== 'overflow')) return -1
        out[0] = scenario === 'entry-pointer' ? null : 456n
        return 0
      }
      if (definition.includes('acl_get_tag_type')) return (entry, out) => {
        assert.equal(entry, 456n)
        if (scenario === 'tag-throw') throw Error('tag')
        if (scenario === 'tag-failure') return -1
        if (scenario === 'tag-status') return '0'
        out[0] = ['grant', 'grant-free-failure'].includes(scenario) ? 1 : scenario === 'unknown-tag' ? 99 : scenario === 'tag-malformed' ? '2' : scenario === 'tag-negative' ? -1 : 2
        return 0
      }
      if (definition.includes('acl_free')) return acl => {
        assert.equal(acl, 123n)
        freed++
        if (scenario === 'free-throw') throw Error('free')
        return ['free-failure', 'grant-free-failure'].includes(scenario) ? -1 : scenario === 'free-malformed' ? '0' : 0
      }
      throw Error('unexpected binding')
    } }
  }
}
mock.module(createRequire(${JSON.stringify(helper)}).resolve('koffi'), () => native)
const { inspectDarwinDirectoryAcl } = await import(${JSON.stringify(helper)})
const fd = openSync('.', 'r')
try {
  const result = inspectDarwinDirectoryAcl(fd)
  const safe = ['deny', 'absent'].includes(scenario)
  assert.deepEqual(result, safe ? { ok: true } : { ok: false, reason: ['grant', 'unknown-tag'].includes(scenario) ? 'unsafe-acl' : 'acl-unavailable' })
  assert.equal(fstatSync(fd).isDirectory(), true)
  const noCopy = ['non-darwin', 'load-failure', 'binding-failure', 'get-throw', 'absent', 'get-failure', 'pointer-malformed', 'pointer-zero'].includes(scenario)
  assert.equal(freed, noCopy ? 0 : 1, scenario + ': copied ACL must be freed exactly once')
  if (scenario === 'non-darwin') assert.equal(loaded, 0)
  if (scenario === 'overflow') assert.equal(entered, 129)
  console.log('verified ' + scenario)
} finally { closeSync(fd) }
`

describe('Darwin directory ACL boundary', () => {
  test('rejects invalid, closed and non-directory descriptors without taking ownership', () => {
    for (const fd of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
      expect(inspectDarwinDirectoryAcl(fd)).toEqual(unavailable)
    }
    const fd = openSync(import.meta.path, 'r')
    try {
      expect(inspectDarwinDirectoryAcl(fd)).toEqual(unavailable)
      expect(fstatSync(fd).isFile()).toBe(true)
    } finally {
      closeSync(fd)
    }
    expect(inspectDarwinDirectoryAcl(fd)).toEqual(unavailable)
  })

  test.skipIf(process.platform !== 'darwin')(
    'handles native failures in isolated processes and retains the borrowed descriptor',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'oauth-acl-mocks-'))
      try {
        const script = join(root, 'mock.ts')
        writeFileSync(script, mockedFixture)
        for (const scenario of [
          'non-darwin',
          'deny',
          'grant',
          'unknown-tag',
          'absent',
          'get-failure',
          'load-failure',
          'binding-failure',
          'get-throw',
          'pointer-malformed',
          'pointer-zero',
          'errno-throw',
          'errno-malformed',
          'invalid-acl',
          'valid-malformed',
          'entry-throw',
          'entry-malformed',
          'entry-positive',
          'entry-failure',
          'entry-pointer',
          'overflow',
          'tag-throw',
          'tag-failure',
          'tag-status',
          'tag-malformed',
          'tag-negative',
          'free-throw',
          'free-failure',
          'grant-free-failure',
          'free-malformed',
        ]) {
          run([process.execPath, script, scenario], root)
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
    60_000,
  )

  test.skipIf(process.platform !== 'darwin')(
    'compiles arm64/x64-baseline and checks real ACLs through forced GC in source and the host binary',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'oauth-acl-compiled-'))
      try {
        const script = join(root, 'native.ts')
        writeFileSync(script, nativeFixture)
        run([process.execPath, script], root)
        for (const { target, arch } of [
          { target: 'bun-darwin-arm64', arch: 'arm64' },
          { target: 'bun-darwin-x64-baseline', arch: 'x64' },
        ]) {
          const binary = join(root, target)
          const build = Bun.spawnSync(
            [process.execPath, 'build', script, '--compile', '--target', target, '--outfile', binary],
            {
              cwd: root,
              stdout: 'pipe',
              stderr: 'pipe',
              timeout: 60_000,
            },
          )
          expect({ exit: build.exitCode, stderr: build.stderr.toString() }).toEqual({
            exit: 0,
            stderr: expect.any(String),
          })
          if (arch === process.arch) run([binary], root)
        }
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    },
    120_000,
  )
})
