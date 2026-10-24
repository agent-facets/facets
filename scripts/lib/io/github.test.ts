import { afterEach, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { githubIo } from './github'

let binDir: string | undefined
afterEach(async () => {
  if (binDir) await rm(binDir, { recursive: true, force: true })
  binDir = undefined
})

test('workflow dispatch uses the REST endpoint and passes the immutable tag as both ref and input', async () => {
  binDir = await mkdtemp(resolve(tmpdir(), 'facet-gh-'))
  const argsPath = resolve(binDir, 'args')
  const ghPath = resolve(binDir, 'gh')
  await Bun.write(ghPath, `#!/bin/sh\nprintf '%s\\n' "$@" > "${argsPath}"\nprintf '%s' '{"workflow_run_id":123}'\n`)
  await chmod(ghPath, 0o755)
  const result = await githubIo.workflowDispatch(
    'release-cli-assets.yml',
    'agent-facets@0.4.0',
    'agent-facets@0.4.0',
    ghPath,
  )

  expect(result.exitCode).toBe(0)
  expect(await readFile(argsPath, 'utf8')).toBe(
    [
      'api',
      '--method',
      'POST',
      'repos/agent-facets/facets/actions/workflows/release-cli-assets.yml/dispatches',
      '-f',
      'ref=agent-facets@0.4.0',
      '-f',
      'inputs[tag]=agent-facets@0.4.0',
      '',
    ].join('\n'),
  )
})
