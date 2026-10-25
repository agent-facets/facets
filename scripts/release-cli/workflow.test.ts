import { expect, test } from 'bun:test'

test('npm deployment precedes the attested GitHub archive release', async () => {
  const source = await Bun.file(new URL('../../.circleci/release/workflows/release-cli.yml', import.meta.url)).text()
  const workflow = Bun.YAML.parse(source) as {
    jobs: Record<string, { requires?: string[]; 'serial-group'?: string }>[]
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

  expect(jobs.has('package-cli-assets')).toBe(false)
  expect(jobs.has('upload-cli-assets')).toBe(false)
  expect(jobs.has('dispatch-cli-release')).toBe(true)
  expect([...dependencies('publish-platform')]).toEqual(['build-cli'])
  expect([...dependencies('finalize-cli')]).toEqual(['publish-platform', 'build-cli'])
  expect([...dependencies('dispatch-cli-release')]).toEqual(['finalize-cli', 'publish-platform', 'build-cli'])
  expect(jobs.get('dispatch-cli-release')?.['serial-group']).toBe('<< pipeline.project.slug >>/release-cli-assets')
})
