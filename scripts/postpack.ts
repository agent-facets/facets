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
  console.log('postpack: restored original package.json')
} else {
  console.log('postpack: no backup found, nothing to restore')
}
