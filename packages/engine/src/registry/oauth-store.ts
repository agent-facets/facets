import { Database } from 'bun:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import { closeSync, constants, fsyncSync, openSync, type Stats } from 'node:fs'
import { type FileHandle, lstat, mkdir, open, rename, rm, statfs } from 'node:fs/promises'
import { join } from 'node:path'
import { resolveFacetDir } from '../facet-dir.ts'

const OAUTH_SESSION_VERSION = 1
const DEFAULT_LOCK_TIMEOUT_MS = 5_000
const DEFAULT_LOCK_POLL_MS = 20
const SQLITE_SIDECAR_SUFFIXES = ['-journal', '-wal', '-shm']
const LINUX_NETWORK_FILESYSTEM_TYPES = new Set([
  0x5346414f, // AFS
  0x6b414653, // AFS
  0x00c36400, // Ceph
  0x73757245, // CODA
  0x0000564c, // NCP
  0x00006969, // NFS
  0x0000517b, // SMB
  0xff534d42, // CIFS
  0xfe534d42, // SMB2
  0x01021997, // 9P
])
const lockBrand = Symbol('oauth-session-lock')
const SESSION_KEYS = new Set([
  'version',
  'registry_origin',
  'client_id',
  'issuer',
  'authorization_endpoint',
  'token_endpoint',
  'verification_origin',
  'access_token',
  'refresh_token',
  'expires_at',
  'subject',
  'session_id',
  'user_uuid',
  'generation',
  'status',
  'refresh_started_at',
  'refresh_attempts',
])

export type OAuthSessionStatus = 'ready' | 'uncertain' | 'reauth-required'

export interface OAuthSessionBinding {
  registry_origin: string
  client_id: string
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  verification_origin: string
}

interface OAuthSessionBase extends OAuthSessionBinding {
  version: 1
  access_token: string
  refresh_token: string
  expires_at: number
  subject: string
  session_id: string
  user_uuid: string
  generation: number
}

export interface ReadyOAuthSession extends OAuthSessionBase {
  status: 'ready'
  refresh_started_at?: never
  refresh_attempts?: never
}

export interface UncertainOAuthSession extends OAuthSessionBase {
  status: 'uncertain'
  refresh_started_at: number
  refresh_attempts: 1 | 2 | 3
}

export interface ReauthRequiredOAuthSession extends OAuthSessionBase {
  status: 'reauth-required'
  refresh_started_at?: never
  refresh_attempts?: never
}

export type OAuthSession = ReadyOAuthSession | UncertainOAuthSession | ReauthRequiredOAuthSession

export type OAuthStoreError =
  | {
      code: 'UNSUPPORTED_PLATFORM'
      platform: string
      guidance: 'Browser login is unavailable on this platform; use FACET_TOKEN or PAT login.'
    }
  | { code: 'INVALID_BINDING'; issues: ReadonlyArray<string> }
  | { code: 'INVALID_SESSION'; path: string; issues: ReadonlyArray<string> }
  | {
      code: 'UNSAFE_STATE'
      path: string
      reason: 'symlink' | 'wrong-kind' | 'wrong-owner' | 'insecure-permissions' | 'multiple-links'
    }
  | { code: 'IO_ERROR'; operation: string; path: string; cause: string }
  | {
      code: 'UNSUPPORTED_FILESYSTEM'
      path: string
      filesystem_type: string
      guidance: 'Browser login requires a local filesystem for OAuth state.'
    }
  | { code: 'LOCK_TIMEOUT'; path: string; timeout_ms: number }
  | { code: 'LOCK_LOST'; path: string }
  | { code: 'GENERATION_CONFLICT'; expected: number | null; actual: number | null }

export type OAuthStoreResult<T> = { ok: true; value: T } | { ok: false; error: OAuthStoreError }

export interface OAuthStoreOptions {
  platform?: string
  resolveFacetDir?: () => string
  ownerUid?: number
  lockTimeoutMs?: number
  lockPollMs?: number
  statfs?: (path: string) => Promise<{ type: bigint }>
  lstat?: (path: string) => Promise<Stats>
}

export interface OAuthSessionLock {
  readonly registry_origin: string
  readonly [lockBrand]: true
}

interface StoreContext {
  root: string
  statePath: string
  lockPath: string
  platform: string
  ownerUid: number
  lockTimeoutMs: number
  lockPollMs: number
  statfs: (path: string) => Promise<{ type: bigint }>
  lstat: (path: string) => Promise<Stats>
}

interface HeldLock extends OAuthSessionLock {
  readonly binding: OAuthSessionBinding
  readonly context: StoreContext
  readonly database: Database
  readonly deadline: number
}

const heldLocks = new WeakMap<OAuthSessionLock, HeldLock>()

export function isOAuthStorePlatformSupported(platform: string = process.platform): platform is 'darwin' | 'linux' {
  return platform === 'darwin' || platform === 'linux'
}

export async function readOAuthSession(
  binding: OAuthSessionBinding,
  options: OAuthStoreOptions = {},
): Promise<OAuthStoreResult<OAuthSession | null>> {
  const context = prepareContext(binding, options)
  if (!context.ok) return context

  const root = await ensureOAuthRoot(context.value)
  if (!root.ok) return root
  const filesystem = await requireLocalFilesystem(context.value)
  if (!filesystem.ok) return filesystem
  return readSessionFile(binding, context.value)
}

export async function saveOAuthSession(
  session: OAuthSession,
  expectedGeneration: number | null,
  lock: OAuthSessionLock,
  options: Pick<OAuthStoreOptions, 'platform'> = {},
): Promise<OAuthStoreResult<void>> {
  const platform = options.platform ?? process.platform
  if (!isOAuthStorePlatformSupported(platform)) return unsupportedPlatform(platform)
  const held = inspectHeldLock(lock)
  if (!held.ok) return held

  const issues = validateSession(session)
  if (issues.length > 0) {
    return { ok: false, error: { code: 'INVALID_SESSION', path: held.value.context.statePath, issues } }
  }
  const bindingIssue = bindingMismatch(held.value.binding, session)
  if (bindingIssue !== null) {
    return {
      ok: false,
      error: {
        code: 'INVALID_SESSION',
        path: held.value.context.statePath,
        issues: [bindingIssue],
      },
    }
  }

  const owned = await verifyLockOwner(held.value)
  if (!owned.ok) return owned
  const current = await readSessionFile(bindingOf(session), held.value.context)
  if (!current.ok) return current
  const actual = current.value?.generation ?? null
  if (actual !== expectedGeneration) {
    return { ok: false, error: { code: 'GENERATION_CONFLICT', expected: expectedGeneration, actual } }
  }
  const nextGeneration = (actual ?? 0) + 1
  if (session.generation !== nextGeneration) {
    return {
      ok: false,
      error: {
        code: 'INVALID_SESSION',
        path: held.value.context.statePath,
        issues: [`generation must be ${nextGeneration}`],
      },
    }
  }
  const transitionIssues = validateTransition(current.value, session)
  if (transitionIssues.length > 0) {
    return {
      ok: false,
      error: { code: 'INVALID_SESSION', path: held.value.context.statePath, issues: transitionIssues },
    }
  }
  return atomicWriteSession(session, held.value.context)
}

export async function deleteOAuthSession(
  binding: OAuthSessionBinding,
  expectedGeneration: number | null,
  lock: OAuthSessionLock,
  options: Pick<OAuthStoreOptions, 'platform'> = {},
): Promise<OAuthStoreResult<boolean>> {
  const platform = options.platform ?? process.platform
  if (!isOAuthStorePlatformSupported(platform)) return unsupportedPlatform(platform)
  const held = inspectHeldLock(lock)
  if (!held.ok) return held
  const bindingIssues = validateBinding(binding)
  if (bindingIssues.length > 0) return { ok: false, error: { code: 'INVALID_BINDING', issues: bindingIssues } }
  if (bindingMismatch(held.value.binding, binding) !== null) {
    return { ok: false, error: { code: 'LOCK_LOST', path: held.value.context.lockPath } }
  }

  const owned = await verifyLockOwner(held.value)
  if (!owned.ok) return owned
  const current = await readSessionFile(binding, held.value.context)
  if (!current.ok) return current
  const actual = current.value?.generation ?? null
  if (actual !== expectedGeneration) {
    return { ok: false, error: { code: 'GENERATION_CONFLICT', expected: expectedGeneration, actual } }
  }
  if (current.value === null) return { ok: true, value: false }

  try {
    await rm(held.value.context.statePath)
    await syncDirectory(held.value.context.root)
    return { ok: true, value: true }
  } catch (error) {
    return ioFailure('delete session', held.value.context.statePath, error)
  }
}

export async function withOAuthSessionLock<T>(
  binding: OAuthSessionBinding,
  operation: (lock: OAuthSessionLock) => Promise<OAuthStoreResult<T>>,
  options: OAuthStoreOptions = {},
): Promise<OAuthStoreResult<T>> {
  const context = prepareContext(binding, options)
  if (!context.ok) return context

  const root = await ensureOAuthRoot(context.value)
  if (!root.ok) return root
  const filesystem = await requireLocalFilesystem(context.value)
  if (!filesystem.ok) return filesystem
  const acquired = await acquireLock(binding, context.value)
  if (!acquired.ok) return acquired

  let result: OAuthStoreResult<T> | undefined
  let thrown: unknown
  try {
    result = await operation(acquired.value)
  } catch (error) {
    thrown = error
  }
  const released = await releaseLock(acquired.value, thrown === undefined)
  if (!released.ok) return released
  if (thrown !== undefined) throw thrown
  if (result === undefined) throw new Error('OAuth lock operation returned no result')
  return result
}

function prepareContext(binding: OAuthSessionBinding, options: OAuthStoreOptions): OAuthStoreResult<StoreContext> {
  const platform = options.platform ?? process.platform
  if (!isOAuthStorePlatformSupported(platform)) return unsupportedPlatform(platform)

  const issues = validateBinding(binding)
  if (issues.length > 0) return { ok: false, error: { code: 'INVALID_BINDING', issues } }

  const ownerUid = options.ownerUid ?? process.getuid?.()
  if (ownerUid === undefined) return unsupportedPlatform(platform)
  const facetDir = (options.resolveFacetDir ?? resolveFacetDir)()
  const root = join(facetDir, 'oauth')
  const key = createHash('sha256').update(binding.registry_origin).digest('hex')
  return {
    ok: true,
    value: {
      root,
      statePath: join(root, `${key}.json`),
      lockPath: join(root, `${key}.lock.sqlite`),
      platform,
      ownerUid,
      lockTimeoutMs: options.lockTimeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS,
      lockPollMs: options.lockPollMs ?? DEFAULT_LOCK_POLL_MS,
      statfs: options.statfs ?? ((path) => statfs(path, { bigint: true })),
      lstat: options.lstat ?? lstat,
    },
  }
}

function unsupportedPlatform(platform: string): OAuthStoreResult<never> {
  return {
    ok: false,
    error: {
      code: 'UNSUPPORTED_PLATFORM',
      platform,
      guidance: 'Browser login is unavailable on this platform; use FACET_TOKEN or PAT login.',
    },
  }
}

async function ensureOAuthRoot(context: StoreContext): Promise<OAuthStoreResult<void>> {
  const facetDir = context.root.slice(0, -'/oauth'.length)
  const facet = await ensureDirectory(facetDir, context.ownerUid, false)
  if (!facet.ok) return facet
  return ensureDirectory(context.root, context.ownerUid, true)
}

async function ensureDirectory(
  path: string,
  ownerUid: number,
  requireOwnerOnly: boolean,
): Promise<OAuthStoreResult<void>> {
  try {
    await mkdir(path, { recursive: false, mode: 0o700 })
  } catch (error) {
    if (!hasCode(error, 'EEXIST')) return ioFailure('create directory', path, error)
  }
  const safe = await inspectPath(path, 'directory', ownerUid, requireOwnerOnly ? 0o700 : null)
  return safe.ok ? { ok: true, value: undefined } : safe
}

async function readSessionFile(
  binding: OAuthSessionBinding,
  context: StoreContext,
): Promise<OAuthStoreResult<OAuthSession | null>> {
  const inspected = await inspectPath(context.statePath, 'file', context.ownerUid, 0o600, true, context.lstat)
  if (!inspected.ok) return inspected
  if (!inspected.value) return { ok: true, value: null }

  let handle: FileHandle | undefined
  try {
    handle = await open(context.statePath, constants.O_RDONLY | noFollowFlag())
    const opened = await handle.stat()
    // Atomic replacement can unlink a private state inode after this reader opens it.
    const safeDescriptor = inspectStats(opened, context.statePath, 'file', context.ownerUid, 0o600, true)
    if (!safeDescriptor.ok) return safeDescriptor
    const raw = await handle.readFile('utf8')
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      return {
        ok: false,
        error: { code: 'INVALID_SESSION', path: context.statePath, issues: ['state is not valid JSON'] },
      }
    }
    const issues = validateSession(parsed)
    if (issues.length > 0 || !isOAuthSession(parsed)) {
      return { ok: false, error: { code: 'INVALID_SESSION', path: context.statePath, issues } }
    }
    const bindingIssue = bindingMismatch(binding, parsed)
    if (bindingIssue !== null) {
      return { ok: false, error: { code: 'INVALID_SESSION', path: context.statePath, issues: [bindingIssue] } }
    }
    return { ok: true, value: parsed }
  } catch (error) {
    return ioFailure('read session', context.statePath, error)
  } finally {
    await handle?.close().catch(() => {})
  }
}

async function atomicWriteSession(session: OAuthSession, context: StoreContext): Promise<OAuthStoreResult<void>> {
  const tempPath = `${context.statePath}.${randomUUID()}.tmp`
  let handle: FileHandle | undefined
  let renamed = false
  try {
    handle = await open(tempPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | noFollowFlag(), 0o600)
    await handle.writeFile(`${JSON.stringify(session, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = undefined

    const safeTemp = await inspectPath(tempPath, 'file', context.ownerUid, 0o600, false, context.lstat)
    if (!safeTemp.ok) return safeTemp
    await rename(tempPath, context.statePath)
    renamed = true
    const safeState = await inspectPath(context.statePath, 'file', context.ownerUid, 0o600, false, context.lstat)
    if (!safeState.ok) return safeState
    await syncDirectory(context.root)
    return { ok: true, value: undefined }
  } catch (error) {
    return ioFailure('write session', context.statePath, error)
  } finally {
    await handle?.close().catch(() => {})
    if (!renamed) await rm(tempPath, { force: true }).catch(() => {})
  }
}

async function requireLocalFilesystem(context: StoreContext): Promise<OAuthStoreResult<void>> {
  let filesystem: { type: bigint }
  try {
    filesystem = await context.statfs(context.root)
  } catch (error) {
    return ioFailure('inspect filesystem', context.root, error)
  }
  if (context.platform !== 'linux') return { ok: true, value: undefined }

  const normalized = Number(BigInt.asUintN(32, filesystem.type))
  if (!LINUX_NETWORK_FILESYSTEM_TYPES.has(normalized)) return { ok: true, value: undefined }
  return {
    ok: false,
    error: {
      code: 'UNSUPPORTED_FILESYSTEM',
      path: context.root,
      filesystem_type: `0x${normalized.toString(16)}`,
      guidance: 'Browser login requires a local filesystem for OAuth state.',
    },
  }
}

async function acquireLock(binding: OAuthSessionBinding, context: StoreContext): Promise<OAuthStoreResult<HeldLock>> {
  const deadline = Date.now() + context.lockTimeoutMs
  const created = createCoordinationDatabase(context)
  if (!created.ok) return created
  const safe = await inspectCoordinationPaths(context)
  if (!safe.ok) return safe

  const opened = await openCoordinationDatabase(context, deadline)
  if (!opened.ok) return opened
  const database = opened.value
  const begun = await executeWithBusyRetry(database, 'BEGIN IMMEDIATE', deadline, context)
  if (!begun.ok) {
    try {
      database.close(true)
    } catch (error) {
      return sqliteFailure('close lock', context.lockPath, sqliteErrorCode(error))
    }
    return begun
  }

  const lock: HeldLock = {
    registry_origin: binding.registry_origin,
    binding: { ...binding },
    context,
    database,
    deadline,
    [lockBrand]: true,
  }
  heldLocks.set(lock, lock)
  return { ok: true, value: lock }
}

async function openCoordinationDatabase(context: StoreContext, deadline: number): Promise<OAuthStoreResult<Database>> {
  while (true) {
    let database: Database | undefined
    try {
      database = new Database(context.lockPath, { create: false, readwrite: true, strict: true })
      database.exec('PRAGMA busy_timeout = 0')
      const mode = database.query<{ journal_mode: string }, []>('PRAGMA journal_mode').get()
      if (mode?.journal_mode.toLowerCase() !== 'delete') {
        database.close(true)
        return sqliteFailure('validate journal mode', context.lockPath, 'SQLITE_UNSAFE_JOURNAL_MODE')
      }
      return { ok: true, value: database }
    } catch (error) {
      try {
        database?.close(true)
      } catch (closeError) {
        return sqliteFailure('close lock', context.lockPath, sqliteErrorCode(closeError))
      }
      if (!isSqliteBusy(error)) return sqliteFailure('open lock', context.lockPath, sqliteErrorCode(error))
      if (Date.now() >= deadline) {
        return { ok: false, error: { code: 'LOCK_TIMEOUT', path: context.lockPath, timeout_ms: context.lockTimeoutMs } }
      }
      await sleep(Math.min(context.lockPollMs, Math.max(1, deadline - Date.now())))
      const safe = await inspectCoordinationPaths(context)
      if (!safe.ok) return safe
    }
  }
}

function createCoordinationDatabase(context: StoreContext): OAuthStoreResult<void> {
  let descriptor: number | undefined
  let directoryDescriptor: number | undefined
  try {
    descriptor = openSync(
      context.lockPath,
      constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | noFollowFlag(),
      0o600,
    )
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = undefined
    directoryDescriptor = openSync(context.root, constants.O_RDONLY)
    fsyncSync(directoryDescriptor)
    closeSync(directoryDescriptor)
    directoryDescriptor = undefined
    return { ok: true, value: undefined }
  } catch (error) {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {}
    }
    if (directoryDescriptor !== undefined) {
      try {
        closeSync(directoryDescriptor)
      } catch {}
    }
    return hasCode(error, 'EEXIST') ? { ok: true, value: undefined } : ioFailure('create lock', context.lockPath, error)
  }
}

async function inspectCoordinationPaths(context: StoreContext): Promise<OAuthStoreResult<void>> {
  const database = await inspectPath(context.lockPath, 'file', context.ownerUid, 0o600, false, context.lstat)
  if (!database.ok) return database
  for (const suffix of SQLITE_SIDECAR_SUFFIXES) {
    const sidecar = await inspectPath(
      `${context.lockPath}${suffix}`,
      'file',
      context.ownerUid,
      0o600,
      true,
      context.lstat,
    )
    if (!sidecar.ok) return sidecar
  }
  return { ok: true, value: undefined }
}

function inspectHeldLock(lock: OAuthSessionLock): OAuthStoreResult<HeldLock> {
  const held = heldLocks.get(lock)
  return held === undefined ? { ok: false, error: { code: 'LOCK_LOST', path: '<unowned>' } } : { ok: true, value: held }
}

async function verifyLockOwner(lock: HeldLock): Promise<OAuthStoreResult<void>> {
  return heldLocks.get(lock) === lock
    ? { ok: true, value: undefined }
    : { ok: false, error: { code: 'LOCK_LOST', path: lock.context.lockPath } }
}

async function releaseLock(lock: HeldLock, commit: boolean): Promise<OAuthStoreResult<void>> {
  if (!heldLocks.delete(lock)) return { ok: false, error: { code: 'LOCK_LOST', path: lock.context.lockPath } }
  let result: OAuthStoreResult<void>
  try {
    if (commit) {
      result = await executeWithBusyRetry(lock.database, 'COMMIT', lock.deadline, lock.context)
    } else {
      lock.database.exec('ROLLBACK')
      result = { ok: true, value: undefined }
    }
  } catch (error) {
    result = sqliteFailure('release lock', lock.context.lockPath, sqliteErrorCode(error))
  }
  try {
    lock.database.close(true)
  } catch (error) {
    return sqliteFailure('close lock', lock.context.lockPath, sqliteErrorCode(error))
  }
  return result
}

async function executeWithBusyRetry(
  database: Database,
  sql: 'BEGIN IMMEDIATE' | 'COMMIT',
  deadline: number,
  context: StoreContext,
): Promise<OAuthStoreResult<void>> {
  while (true) {
    try {
      database.exec(sql)
      return { ok: true, value: undefined }
    } catch (error) {
      if (!isSqliteBusy(error))
        return sqliteFailure(
          sql === 'COMMIT' ? 'commit lock' : 'acquire lock',
          context.lockPath,
          sqliteErrorCode(error),
        )
      if (Date.now() >= deadline) {
        return {
          ok: false,
          error: { code: 'LOCK_TIMEOUT', path: context.lockPath, timeout_ms: context.lockTimeoutMs },
        }
      }
      await sleep(Math.min(context.lockPollMs, Math.max(1, deadline - Date.now())))
    }
  }
}

async function inspectPath(
  path: string,
  kind: 'file' | 'directory',
  ownerUid: number,
  requiredMode: number | null,
  allowMissing = false,
  lstatPath: (path: string) => Promise<Stats> = lstat,
): Promise<OAuthStoreResult<{ dev: number; ino: number } | null>> {
  try {
    const stat = await lstatPath(path)
    return inspectStats(stat, path, kind, ownerUid, requiredMode)
  } catch (error) {
    if (allowMissing && hasCode(error, 'ENOENT')) return { ok: true, value: null }
    return ioFailure('inspect path', path, error)
  }
}

function inspectStats(
  stat: Stats,
  path: string,
  kind: 'file' | 'directory',
  ownerUid: number,
  requiredMode: number | null,
  allowUnlinked = false,
): OAuthStoreResult<{ dev: number; ino: number }> {
  if (stat.isSymbolicLink()) return { ok: false, error: { code: 'UNSAFE_STATE', path, reason: 'symlink' } }
  if ((kind === 'file' && !stat.isFile()) || (kind === 'directory' && !stat.isDirectory())) {
    return { ok: false, error: { code: 'UNSAFE_STATE', path, reason: 'wrong-kind' } }
  }
  if (stat.uid !== ownerUid) return { ok: false, error: { code: 'UNSAFE_STATE', path, reason: 'wrong-owner' } }
  if (requiredMode !== null && (stat.mode & 0o777) !== requiredMode) {
    return { ok: false, error: { code: 'UNSAFE_STATE', path, reason: 'insecure-permissions' } }
  }
  if (kind === 'file' && stat.nlink !== 1 && !(allowUnlinked && stat.nlink === 0)) {
    return { ok: false, error: { code: 'UNSAFE_STATE', path, reason: 'multiple-links' } }
  }
  return { ok: true, value: { dev: stat.dev, ino: stat.ino } }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY)
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

function validateBinding(value: OAuthSessionBinding): string[] {
  const issues: string[] = []
  validateOrigin(value.registry_origin, 'registry_origin', issues)
  validateNonEmpty(value.client_id, 'client_id', issues)
  validateHttpsUrl(value.issuer, 'issuer', issues)
  validateHttpsUrl(value.authorization_endpoint, 'authorization_endpoint', issues)
  validateHttpsUrl(value.token_endpoint, 'token_endpoint', issues)
  validateOrigin(value.verification_origin, 'verification_origin', issues)
  return issues
}

function validateSession(value: unknown): string[] {
  if (!isRecord(value)) return ['session must be an object']
  const issues: string[] = []
  for (const key of Object.keys(value)) {
    if (!SESSION_KEYS.has(key)) issues.push(`unexpected field: ${key}`)
  }
  if (value.version !== OAUTH_SESSION_VERSION) issues.push('version must be 1')
  validateOrigin(value.registry_origin, 'registry_origin', issues)
  validateNonEmpty(value.client_id, 'client_id', issues)
  validateHttpsUrl(value.issuer, 'issuer', issues)
  validateHttpsUrl(value.authorization_endpoint, 'authorization_endpoint', issues)
  validateHttpsUrl(value.token_endpoint, 'token_endpoint', issues)
  validateOrigin(value.verification_origin, 'verification_origin', issues)
  validateNonEmpty(value.access_token, 'access_token', issues)
  validateNonEmpty(value.refresh_token, 'refresh_token', issues)
  if (typeof value.expires_at !== 'number' || !Number.isSafeInteger(value.expires_at) || value.expires_at < 0) {
    issues.push('expires_at must be a non-negative safe integer')
  }
  validateNonEmpty(value.subject, 'subject', issues)
  validateNonEmpty(value.session_id, 'session_id', issues)
  validateNonEmpty(value.user_uuid, 'user_uuid', issues)
  if (typeof value.generation !== 'number' || !Number.isSafeInteger(value.generation) || value.generation < 1) {
    issues.push('generation must be a positive safe integer')
  }
  if (value.status !== 'ready' && value.status !== 'uncertain' && value.status !== 'reauth-required') {
    issues.push('status is invalid')
  } else if (value.status === 'uncertain') {
    if (
      typeof value.refresh_started_at !== 'number' ||
      !Number.isSafeInteger(value.refresh_started_at) ||
      value.refresh_started_at < 0
    ) {
      issues.push('refresh_started_at must be a non-negative safe epoch-millisecond integer')
    }
    if (
      typeof value.refresh_attempts !== 'number' ||
      !Number.isInteger(value.refresh_attempts) ||
      value.refresh_attempts < 1 ||
      value.refresh_attempts > 3
    ) {
      issues.push('refresh_attempts must be an integer from 1 through 3')
    }
  } else {
    if (Object.hasOwn(value, 'refresh_started_at'))
      issues.push('refresh_started_at is allowed only for uncertain state')
    if (Object.hasOwn(value, 'refresh_attempts')) issues.push('refresh_attempts is allowed only for uncertain state')
  }
  return issues
}

function validateTransition(current: OAuthSession | null, next: OAuthSession): string[] {
  if (next.status !== 'uncertain') return []
  if (current === null) return ['uncertain state requires an existing ready session']
  if (current.status === 'reauth-required') return ['reauth-required state cannot begin a refresh']
  if (current.status === 'ready') {
    return next.refresh_attempts === 1 ? [] : ['the first refresh exchange must use refresh_attempts 1']
  }

  const issues: string[] = []
  if (next.refresh_started_at !== current.refresh_started_at) {
    issues.push('refresh_started_at cannot change during one refresh sequence')
  }
  if (next.refresh_attempts !== current.refresh_attempts + 1) {
    issues.push('refresh_attempts must increment by exactly one')
  }
  return issues
}

function isOAuthSession(value: unknown): value is OAuthSession {
  return validateSession(value).length === 0
}

function bindingOf(session: OAuthSession): OAuthSessionBinding {
  return {
    registry_origin: session.registry_origin,
    client_id: session.client_id,
    issuer: session.issuer,
    authorization_endpoint: session.authorization_endpoint,
    token_endpoint: session.token_endpoint,
    verification_origin: session.verification_origin,
  }
}

function bindingMismatch(expected: OAuthSessionBinding, actual: OAuthSessionBinding): string | null {
  for (const key of [
    'registry_origin',
    'client_id',
    'issuer',
    'authorization_endpoint',
    'token_endpoint',
    'verification_origin',
  ] satisfies ReadonlyArray<keyof OAuthSessionBinding>) {
    if (expected[key] !== actual[key]) return `${key} differs from current configuration`
  }
  return null
}

function validateNonEmpty(value: unknown, field: string, issues: string[]): void {
  if (typeof value !== 'string' || value.trim().length === 0) issues.push(`${field} must be a non-empty string`)
}

function validateOrigin(value: unknown, field: string, issues: string[]): void {
  if (typeof value !== 'string') {
    issues.push(`${field} must be an HTTPS origin`)
    return
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.origin !== value || url.username !== '' || url.password !== '') {
      issues.push(`${field} must be an HTTPS origin`)
    }
  } catch {
    issues.push(`${field} must be an HTTPS origin`)
  }
}

function validateHttpsUrl(value: unknown, field: string, issues: string[]): void {
  if (typeof value !== 'string') {
    issues.push(`${field} must be an HTTPS URL`)
    return
  }
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') {
      issues.push(`${field} must be an HTTPS URL`)
    }
  } catch {
    issues.push(`${field} must be an HTTPS URL`)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function noFollowFlag(): number {
  return constants.O_NOFOLLOW ?? 0
}

function hasCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code
}

function isSqliteBusy(error: unknown): boolean {
  return isRecord(error) && (error.code === 'SQLITE_BUSY' || error.errno === 5)
}

function sqliteErrorCode(error: unknown): string {
  if (!isRecord(error)) return 'SQLITE_ERROR'
  if (typeof error.code === 'string' && error.code.startsWith('SQLITE_')) return error.code
  if (typeof error.errno === 'number') return `SQLITE_ERRNO_${error.errno}`
  return 'SQLITE_ERROR'
}

function sqliteFailure<T>(operation: string, path: string, cause: string): OAuthStoreResult<T> {
  return { ok: false, error: { code: 'IO_ERROR', operation, path, cause } }
}

function ioFailure<T>(operation: string, path: string, error: unknown): OAuthStoreResult<T> {
  return {
    ok: false,
    error: { code: 'IO_ERROR', operation, path, cause: error instanceof Error ? error.message : String(error) },
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
