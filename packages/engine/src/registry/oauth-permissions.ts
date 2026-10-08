import { fstatSync } from 'node:fs'

export type DarwinDirectoryAclResult = { ok: true } | { ok: false; reason: 'unsafe-acl' | 'acl-unavailable' }

const unavailable: DarwinDirectoryAclResult = { ok: false, reason: 'acl-unavailable' }

function isPointer(value: unknown): value is bigint {
  return typeof value === 'bigint' && value > 0n && value <= 0xffffffffffffffffn
}

function loadBindings() {
  // CJS preserves Koffi's native addon when Bun embeds this module in a standalone CLI.
  const koffi: typeof import('koffi').default = require('koffi')
  const lib = koffi.load('/usr/lib/libSystem.B.dylib')
  const get = lib.func('void *acl_get_fd_np(int fd, int type)')
  const valid = lib.func('int acl_valid(void *acl)')
  const entry = lib.func('int acl_get_entry(void *acl, int id, _Out_ void **entry)')
  const tag = lib.func('int acl_get_tag_type(void *entry, _Out_ uint32_t *tag)')
  const free = lib.func('int acl_free(void *ptr)')
  return { koffi, lib, get, valid, entry, tag, free }
}

// Retain native bindings for process lifetime: Bun finalization cannot safely release them during GC.
let bindings: ReturnType<typeof loadBindings> | undefined

export function inspectDarwinDirectoryAcl(fd: number): DarwinDirectoryAclResult {
  if (process.platform !== 'darwin' || !Number.isInteger(fd) || fd < 0) return unavailable
  try {
    if (!fstatSync(fd).isDirectory()) return unavailable
    bindings ??= loadBindings()
    const { koffi, get, valid, entry, tag, free } = bindings
    const acl: unknown = get(fd, 0x100)
    let result: DarwinDirectoryAclResult = unavailable
    try {
      const error: unknown = koffi.errno()
      if (acl === null) {
        return typeof error === 'number' && error === koffi.os.errno.ENOENT ? { ok: true } : unavailable
      }
      if (!isPointer(acl)) return unavailable
      const validation: unknown = valid(acl)
      if (validation === 0) {
        for (let index = 0; index <= 128; index++) {
          const next: unknown[] = [null]
          const status: unknown = entry(acl, index === 0 ? 0 : -1, next)
          const entryError: unknown = koffi.errno()
          // Darwin reports end as EINVAL for this validated, private, unmodified ACL.
          if (status === -1) {
            if (typeof entryError === 'number' && entryError === koffi.os.errno.EINVAL) result = { ok: true }
            break
          }
          if (status !== 0 || !isPointer(next[0]) || index === 128) break
          const kind: unknown[] = [null]
          const tagStatus: unknown = tag(next[0], kind)
          if (
            tagStatus !== 0 ||
            typeof kind[0] !== 'number' ||
            !Number.isInteger(kind[0]) ||
            kind[0] < 0 ||
            kind[0] > 0xffffffff
          )
            break
          if (kind[0] !== 2) {
            result = { ok: false, reason: 'unsafe-acl' }
            break
          }
        }
      }
    } finally {
      if (isPointer(acl)) {
        const freed: unknown = free(acl)
        if (freed !== 0) result = unavailable
      }
    }
    return result
  } catch {
    return unavailable
  }
}
