import path from 'node:path'
import { fileURLToPath } from 'node:url'

// TypeScript 7 (the Go-native compiler) ships only the `tsc` binary — no JS
// API — so tsdown's default `eager` dts mode (which imports `typescript`)
// can't run. rolldown-plugin-dts's `tsgo` mode instead spawns a compiler
// binary; typescript@7's own `bin/tsc` IS that binary. Point the plugin at it.
export const tscPath = path.join(path.dirname(fileURLToPath(import.meta.resolve('typescript/package.json'))), 'bin/tsc')

// rolldown-plugin-dts derives `rootDir` from `dirname(tsconfig)` and looks up
// emitted d.ts files relative to it. Packages that `alwaysBundle` workspace
// sources (`@agent-facets/common`, `@agent-facets/adapter`) reference files
// outside their own directory, so a per-package tsconfig can't cover them.
// This shared config at the repo root includes every bundled source dir, so
// its rootDir (the repo root) spans all of them.
export const dtsTsconfigPath = fileURLToPath(new URL('./tsconfig.dts.json', import.meta.url))
