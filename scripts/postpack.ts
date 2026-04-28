/**
 * Postpack entry point — run via `bun ../../scripts/postpack.ts` from a
 * package directory after `npm publish` or `changeset publish` creates
 * the tarball.
 *
 * Restores the original package.json from the backup created by prepack.ts.
 */

import { resolve } from 'node:path'

const cwd = process.cwd()
const pkgPath = resolve(cwd, 'package.json')
const bakPath = resolve(cwd, '.package.json.bak')

const bakFile = Bun.file(bakPath)

if (await bakFile.exists()) {
  await Bun.file(pkgPath).write(await bakFile.text())
  await bakFile.unlink()
  // Diagnostic output goes to stderr so `bun pm pack --quiet` stdout stays
  // parseable by `packAndPublish` (see scripts/lib/npm.ts#extractPackFilename).
  console.error('postpack: restored original package.json')
} else {
  console.error('postpack: no backup found, nothing to restore')
}
