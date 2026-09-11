import { expect, test } from 'bun:test'

test('npm deployment has no direct or transitive dependency on archive packaging', async () => {
  const source = await Bun.file(new URL('../../.circleci/release/workflows/release-cli.yml', import.meta.url)).text()
  const workflow = Bun.YAML.parse(source) as {
    jobs: Record<string, { requires?: string[] }>[]
  }
  const jobs = new Map(workflow.jobs.flatMap(Object.entries))
  function dependencies(name: string, seen = new Set<string>()): Set<string> {
    for (const dependency of jobs.get(name)?.requires ?? []) {
      if (seen.has(dependency)) continue
      seen.add(dependency)
      dependencies(dependency, seen)
    }
    return seen
  }

  expect(jobs.has('package-cli-assets')).toBe(true)
  expect(jobs.has('upload-cli-assets')).toBe(true)
  expect([...dependencies('package-cli-assets')]).toEqual(['build-cli'])
  expect([...dependencies('publish-platform')]).toEqual(['build-cli'])
  expect([...dependencies('finalize-cli')]).toEqual(['publish-platform', 'build-cli'])
  expect([...dependencies('upload-cli-assets')]).toEqual([
    'finalize-cli',
    'publish-platform',
    'build-cli',
    'package-cli-assets',
  ])
})
