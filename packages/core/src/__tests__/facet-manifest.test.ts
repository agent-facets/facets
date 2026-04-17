import { describe, expect, test } from 'bun:test'
import { type } from 'arktype'
import { type FacetManifest, FacetManifestSchema } from '../schemas/facet-manifest.ts'

// --- Valid manifests ---

describe('FacetManifestSchema — valid manifests', () => {
  test('minimal manifest with a skill', () => {
    const input = {
      name: 'my-facet',
      version: '1.0.0',
      skills: {
        'code-review': {
          description: 'Reviews code for issues',
        },
      },
    }
    const result = FacetManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as FacetManifest
    expect(data.name).toBe('my-facet')
    expect(data.version).toBe('1.0.0')
    expect(data.skills?.['code-review']?.description).toBe('Reviews code for issues')
  })

  test('full manifest with all sections', () => {
    const input = {
      name: 'acme-dev',
      version: '1.0.0',
      description: 'Acme developer toolkit',
      author: 'acme-org',
      skills: {
        'code-standards': {
          description: 'Org coding standards',
        },
        'pr-template': {
          description: 'PR template guidelines',
        },
      },
      agents: {
        reviewer: {
          description: 'Org code reviewer',
          harnesses: {
            opencode: { tools: { grep: true, bash: true } },
          },
        },
        'quick-check': {
          description: 'Fast lint check',
        },
      },
      commands: {
        review: {
          description: 'Run a code review',
        },
      },
      facets: [
        'code-review-base@1.0.0',
        {
          name: 'typescript-patterns',
          version: '2.1.0',
          skills: ['ts-conventions', 'any-usage'],
        },
      ],
      servers: {
        jira: '1.0.0',
        github: '2.3.0',
        '@acme/deploy': '0.5.0',
        slack: { image: 'ghcr.io/acme/slack-bot:v2' },
      },
    }
    const result = FacetManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as FacetManifest
    expect(data.name).toBe('acme-dev')
    expect(data.agents?.reviewer?.description).toBe('Org code reviewer')
    expect(data.agents?.['quick-check']?.description).toBe('Fast lint check')
    expect(data.servers?.jira).toBe('1.0.0')
    expect(data.servers?.slack).toEqual({
      image: 'ghcr.io/acme/slack-bot:v2',
    })
  })

  test('manifest with only composed facets is valid', () => {
    const input = {
      name: 'composed-only',
      version: '1.0.0',
      facets: ['base@1.0.0'],
    }
    const result = FacetManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
  })
})

// --- Invalid manifests ---

describe('FacetManifestSchema — invalid manifests', () => {
  test('missing name', () => {
    const input = { version: '1.0.0', skills: { x: { description: 'A skill' } } }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  test('missing version', () => {
    const input = { name: 'my-facet', skills: { x: { description: 'A skill' } } }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  test('agent missing description', () => {
    const input = {
      name: 'my-facet',
      version: '1.0.0',
      agents: {
        reviewer: { harnesses: { opencode: {} } },
      },
    }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
    const errors = result as InstanceType<typeof type.errors>
    expect(errors.some((e) => e.path.includes('reviewer') && e.path.includes('description'))).toBe(true)
  })

  test('server reference object without image field', () => {
    const input = {
      name: 'my-facet',
      version: '1.0.0',
      skills: { x: { description: 'A skill' } },
      servers: {
        bad: { notImage: 'ghcr.io/something' },
      },
    }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
    const errors = result as InstanceType<typeof type.errors>
    expect(errors.some((e) => e.path.includes('bad'))).toBe(true)
  })

  test('no text assets → schema error', () => {
    const input = {
      name: 'empty',
      version: '1.0.0',
      servers: { jira: '1.0.0' },
    }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
    const errors = result as InstanceType<typeof type.errors>
    expect(errors.some((e) => e.message.includes('at least one text asset'))).toBe(true)
  })

  test('selective facets entry with no asset selection → schema error', () => {
    const input = {
      name: 'bad-selective',
      version: '1.0.0',
      facets: [{ name: 'other', version: '1.0.0' }],
    }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
    const errors = result as InstanceType<typeof type.errors>
    expect(errors.some((e) => e.message.includes('at least one asset type'))).toBe(true)
  })
})

// --- Unknown field pass-through ---

describe('FacetManifestSchema — unknown field tolerance', () => {
  test('top-level unknown field is preserved', () => {
    const input = {
      name: 'my-facet',
      version: '1.0.0',
      skills: { x: { description: 'A skill' } },
      license: 'MIT',
    }
    const result = FacetManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as FacetManifest & { license: string }
    expect(data.license).toBe('MIT')
  })

  test('unknown field nested in agent descriptor is preserved', () => {
    const input = {
      name: 'my-facet',
      version: '1.0.0',
      agents: {
        reviewer: {
          description: 'A reviewer agent',
          model: 'claude-sonnet',
        },
      },
    }
    const result = FacetManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as Record<string, unknown>
    const agents = data.agents as Record<string, Record<string, unknown>> | undefined
    expect(agents?.reviewer?.model).toBe('claude-sonnet')
  })
})
