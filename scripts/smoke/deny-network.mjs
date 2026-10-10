/**
 * Preload that makes Node's ordinary network entry points throw.
 *
 * Loaded with `node --import` by `node-only.mjs --deny-network`. It covers
 * `fetch`, `WebSocket`, `http`/`https` requests, `net`/`tls` connections, and
 * DNS lookups, then re-syncs the builtin ESM namespaces so a named import taken
 * after this point sees the guard too.
 *
 * It is a regression guard: it catches code that reaches for the network
 * through the standard APIs. It is not an operating-system sandbox and makes
 * no claim to stop native addons or a spawned process. Callers should prove it
 * is active with a canary before relying on it.
 */

import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import { syncBuiltinESMExports } from 'node:module'
import net from 'node:net'
import tls from 'node:tls'

/** The marker a canary looks for to tell a guard refusal from any other error. */
export const NETWORK_DENIED = 'network access denied'

function deny(what) {
  return () => {
    throw new Error(`${NETWORK_DENIED}: ${what}`)
  }
}

globalThis.fetch = deny('fetch')
if ('WebSocket' in globalThis) {
  globalThis.WebSocket = class {
    constructor() {
      throw new Error(`${NETWORK_DENIED}: WebSocket`)
    }
  }
}

http.request = deny('http.request')
http.get = deny('http.get')
https.request = deny('https.request')
https.get = deny('https.get')
net.connect = deny('net.connect')
net.createConnection = deny('net.createConnection')
net.Socket.prototype.connect = deny('net.Socket.connect')
tls.connect = deny('tls.connect')
dns.lookup = deny('dns.lookup')
dns.resolve = deny('dns.resolve')
dns.promises.lookup = deny('dns.promises.lookup')
dns.promises.resolve = deny('dns.promises.resolve')

syncBuiltinESMExports()
