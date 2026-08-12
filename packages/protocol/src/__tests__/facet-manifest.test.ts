import { describe, expect, test } from 'bun:test'
import { type FacetManifest, FacetManifestSchema, LegacyFacetManifestSchema } from '@agent-facets/protocol'
import { type } from 'arktype'

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
          adapters: {
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
        jira: { type: 'stdio', command: 'jira-mcp', args: ['--project', 'ACME'], env: { JIRA_SITE: 'acme' } },
        slack: { type: 'http', url: 'https://mcp.example.com/slack' },
      },
    }
    const result = FacetManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as FacetManifest
    expect(data.name).toBe('acme-dev')
    expect(data.agents?.reviewer?.description).toBe('Org code reviewer')
    expect(data.agents?.['quick-check']?.description).toBe('Fast lint check')
    // Argument order and literal environment values survive validation
    // unchanged — nothing about a declaration is normalized.
    expect(data.servers?.jira).toEqual({
      type: 'stdio',
      command: 'jira-mcp',
      args: ['--project', 'ACME'],
      env: { JIRA_SITE: 'acme' },
    })
    expect(data.servers?.slack).toEqual({ type: 'http', url: 'https://mcp.example.com/slack' })
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

  test('manifest with a scoped facet identity is valid', () => {
    const input = {
      name: '@julian/cowsay',
      version: '1.0.0',
      skills: { cowsay: { description: 'Cowsay tools' } },
    }
    const result = FacetManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as FacetManifest
    expect(data.name).toBe('@julian/cowsay')
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

  // Facet identity grammar (protocol__schemas/spec.md). The manifest `name`
  // must be a valid facet name — an unscoped slug or a scoped `@scope/name`.
  // This intentionally tightens the previous `name: string` behavior so
  // malformed legacy-ish identities (which used to pass) now fail.
  test.each([
    '@julian', // missing slash
    '@/cowsay', // empty scope
    '@julian/', // empty name
    '@julian/cow/say', // extra path depth
    '@julian/cow_say', // underscore
    'Cowsay', // uppercase
    '../cowsay', // traversal
    'cow_say', // underscore (unscoped)
    'cow say', // space
    'a', // single character
    'abc--def', // consecutive hyphens
    'scope/name', // legacy scoped syntax without at-prefix
    'gооgle', // Cyrillic homoglyphs
    'a'.repeat(65), // exceeds maximum length
  ])('malformed facet identity %p is rejected', (name) => {
    const input = { name, version: '1.0.0', skills: { x: { description: 'A skill' } } }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
    const errors = result as InstanceType<typeof type.errors>
    expect(errors.some((e) => e.message.includes('valid facet name'))).toBe(true)
  })

  test('agent missing description', () => {
    const input = {
      name: 'my-facet',
      version: '1.0.0',
      agents: {
        reviewer: { adapters: { opencode: {} } },
      },
    }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
    const errors = result as InstanceType<typeof type.errors>
    expect(errors.some((e) => e.path.includes('reviewer') && e.path.includes('description'))).toBe(true)
  })

  test('server declaration without a transport tag', () => {
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

  test('no deliverable at all → schema error', () => {
    const input = {
      name: 'empty',
      version: '1.0.0',
    }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
    const errors = result as InstanceType<typeof type.errors>
    expect(errors.some((e) => e.message.includes('at least one deliverable'))).toBe(true)
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

  // Path-traversal gate (F1): asset-name keys are used as filesystem paths in
  // the install pipeline. Any `..` or empty segment would escape or dead-end
  // the adapter base dir. The Agent Skills grammar rejects these as invalid
  // segments, so the message names the grammar rather than "path segments".
  test.each([
    ['..', 'skills'],
    ['../escape', 'skills'],
    ['namespace/../escape', 'skills'],
    ['namespace/..', 'agents'],
    ['./dotdir', 'commands'],
    ['namespace//double-slash', 'skills'],
  ])('asset name %p in %s is rejected', (name, group) => {
    const input: Record<string, unknown> = { name: 'pwn', version: '1.0.0' }
    input[group] = { [name]: { description: 'evil' } }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
    const errors = result as InstanceType<typeof type.errors>
    // The offending key is named, and the grammar reason is surfaced.
    expect(errors.some((e) => e.message.includes(`"${name}"`))).toBe(true)
  })

  // Non-kebab names now fail (the deliberate breaking change): the manifest
  // schema enforces the Agent Skills grammar at build AND install.
  test.each([
    ['MySkill', 'skills'],
    ['foo_bar', 'agents'],
    ['UPPER', 'commands'],
    ['has space', 'skills'],
    ['trailing-', 'agents'],
    ['-leading', 'commands'],
    ['double--hyphen', 'skills'],
  ])('non-kebab asset name %p in %s is rejected', (name, group) => {
    const input: Record<string, unknown> = { name: 'ok', version: '1.0.0' }
    input[group] = { [name]: { description: 'x' } }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
    const errors = result as InstanceType<typeof type.errors>
    expect(errors.some((e) => e.message.includes(`"${name}"`))).toBe(true)
  })

  // Digit-start names are valid per the Agent Skills spec (divergence from the
  // facet identity slug grammar, which requires a letter start).
  test('digit-start asset names are valid', () => {
    const input = { name: 'ok', version: '1.0.0', skills: { '2fa': { description: 'x' } } }
    expect(FacetManifestSchema(input)).not.toBeInstanceOf(type.errors)
  })

  // Current-format names are single-segment only (design D9): slash-namespaced
  // names are a legacy-0.1 concept, isolated to LegacyFacetManifestSchema.
  test('slash-namespaced asset names are rejected in the current schema', () => {
    const input = {
      name: 'ok',
      version: '1.0.0',
      skills: {
        'viper-plans/planning': { description: 'plan things' },
      },
    }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
  })

  test('slash-namespaced asset names remain valid under the legacy schema', () => {
    const input = {
      name: 'ok',
      version: '1.0.0',
      skills: {
        'viper-plans/planning': { description: 'plan things' },
        'viper-plans/review/deep': { description: 'deeper' },
      },
    }
    const result = LegacyFacetManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
  })

  // Windows-style path-traversal gate: a backslash is not in the grammar's
  // charset, so a segment containing one is rejected up front.
  test.each([
    ['..\\escape', 'skills'],
    ['a\\b', 'agents'],
    ['deep\\..\\esc', 'commands'],
  ])('asset name %p in %s is rejected (backslash)', (name, group) => {
    const input: Record<string, unknown> = { name: 'pwn', version: '1.0.0' }
    input[group] = { [name]: { description: 'evil' } }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
    const errors = result as InstanceType<typeof type.errors>
    expect(errors.some((e) => e.message.includes(`"${name}"`))).toBe(true)
  })
})

// --- Privacy declaration (private?: boolean) ---

describe('FacetManifestSchema — privacy declaration', () => {
  test('omitted private is accepted and not synthesized', () => {
    const input = {
      name: 'my-facet',
      version: '1.0.0',
      skills: { x: { description: 'A skill' } },
    }
    const result = FacetManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as FacetManifest
    expect('private' in data).toBe(false)
    expect(data.private).toBeUndefined()
  })

  test('private: false is accepted and preserved', () => {
    const input = {
      name: 'my-facet',
      version: '1.0.0',
      private: false,
      skills: { x: { description: 'A skill' } },
    }
    const result = FacetManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as FacetManifest
    expect(data.private).toBe(false)
  })

  test('private: true is accepted and preserved', () => {
    const input = {
      name: 'my-facet',
      version: '1.0.0',
      private: true,
      skills: { x: { description: 'A skill' } },
    }
    const result = FacetManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as FacetManifest
    expect(data.private).toBe(true)
  })

  test.each([
    ['string', 'true'],
    ['number', 1],
    ['object', {}],
    ['array', []],
    ['null', null],
  ])('non-boolean private (%s) is rejected with a private-pathed error', (_label, value) => {
    const input = {
      name: 'my-facet',
      version: '1.0.0',
      private: value,
      skills: { x: { description: 'A skill' } },
    }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
    const errors = result as InstanceType<typeof type.errors>
    expect(errors.some((e) => e.path.includes('private'))).toBe(true)
  })
})

// --- Command descriptor parity with skills/agents ---

describe('FacetManifestSchema — command descriptor extras', () => {
  test('command accepts an optional adapters block', () => {
    const input = {
      name: 'my-facet',
      version: '1.0.0',
      commands: {
        review: {
          description: 'Run a code review',
          adapters: {
            'claude-code': { 'allowed-tools': ['Read', 'Edit'] },
          },
        },
      },
    }
    const result = FacetManifestSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as FacetManifest
    const review = data.commands?.review as Record<string, unknown> | undefined
    const adapters = review?.adapters as Record<string, unknown> | undefined
    expect(adapters?.['claude-code']).toBeDefined()
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

// --- Current-format additions: shared namespace + supplementary files ---

describe('FacetManifestSchema — shared skill/command namespace', () => {
  test('skill and command with the same name are rejected, identifying both', () => {
    const input = {
      name: 'ok',
      version: '1.0.0',
      skills: { review: { description: 'x' } },
      commands: { review: { description: 'y' } },
    }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
    const errors = result as InstanceType<typeof type.errors>
    expect(errors.some((e) => e.message.includes('skills.review') && e.message.includes('commands.review'))).toBe(true)
  })

  test('agent may share a name with a skill', () => {
    const input = {
      name: 'ok',
      version: '1.0.0',
      skills: { review: { description: 'x' } },
      agents: { review: { description: 'y' } },
    }
    expect(FacetManifestSchema(input)).not.toBeInstanceOf(type.errors)
  })

  test('agent may share a name with a command', () => {
    const input = {
      name: 'ok',
      version: '1.0.0',
      commands: { review: { description: 'x' } },
      agents: { review: { description: 'y' } },
    }
    expect(FacetManifestSchema(input)).not.toBeInstanceOf(type.errors)
  })

  test('legacy schema permits skill/command name sharing', () => {
    const input = {
      name: 'ok',
      version: '1.0.0',
      skills: { review: { description: 'x' } },
      commands: { review: { description: 'y' } },
    }
    expect(LegacyFacetManifestSchema(input)).not.toBeInstanceOf(type.errors)
  })
})

describe('FacetManifestSchema — supplementary file declarations', () => {
  test('top-level and per-skill files declarations are accepted', () => {
    const input = {
      name: 'ok',
      version: '1.0.0',
      skills: { review: { description: 'x', files: ['references/api.md', 'scripts/run.ts'] } },
      files: ['README.md', 'LICENSE', 'docs/notes.md'],
    }
    expect(FacetManifestSchema(input)).not.toBeInstanceOf(type.errors)
  })

  test.each([
    ['../secret'],
    ['/absolute'],
    ['C:/secret'],
    ['docs//guide.md'],
    ['docs\\guide.md'],
    ['aux.txt'],
    ['report.'],
  ])('unsafe top-level path %j is rejected', (path) => {
    const input = { name: 'ok', version: '1.0.0', agents: { a: { description: 'x' } }, files: [path] }
    expect(FacetManifestSchema(input)).toBeInstanceOf(type.errors)
  })

  test('top-level path under skills/ is rejected toward the owning skill', () => {
    const input = {
      name: 'ok',
      version: '1.0.0',
      skills: { review: { description: 'x' } },
      files: ['skills/review/references/api.md'],
    }
    const result = FacetManifestSchema(input)
    expect(result).toBeInstanceOf(type.errors)
    const errors = result as InstanceType<typeof type.errors>
    expect(errors.some((e) => e.message.includes("owning skill's files"))).toBe(true)
  })

  test('skill companion SKILL.md is rejected', () => {
    const input = {
      name: 'ok',
      version: '1.0.0',
      skills: { review: { description: 'x', files: ['SKILL.md'] } },
    }
    expect(FacetManifestSchema(input)).toBeInstanceOf(type.errors)
  })

  test('root facet.json declaration is rejected; nested basename is fine', () => {
    const bad = { name: 'ok', version: '1.0.0', agents: { a: { description: 'x' } }, files: ['facet.json'] }
    expect(FacetManifestSchema(bad)).toBeInstanceOf(type.errors)
    const good = { name: 'ok', version: '1.0.0', agents: { a: { description: 'x' } }, files: ['fixtures/facet.json'] }
    expect(FacetManifestSchema(good)).not.toBeInstanceOf(type.errors)
  })

  test('portable collision between declared paths is rejected', () => {
    const input = {
      name: 'ok',
      version: '1.0.0',
      agents: { a: { description: 'x' } },
      files: ['Docs/guide.md', 'docs/guide.md'],
    }
    expect(FacetManifestSchema(input)).toBeInstanceOf(type.errors)
  })

  test('declared path colliding with a primary asset path is rejected', () => {
    const input = {
      name: 'ok',
      version: '1.0.0',
      agents: { reviewer: { description: 'x' } },
      files: ['agents/reviewer.md'],
    }
    expect(FacetManifestSchema(input)).toBeInstanceOf(type.errors)
  })
})
