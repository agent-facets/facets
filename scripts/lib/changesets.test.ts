import { describe, expect, test } from 'bun:test'
import dedent from 'dedent'
import {
  buildVersionPrBody,
  comparePackageOrder,
  filterPendingChangesets,
  hasUnpublishedVersions,
  parsePublishedPackages,
  replaceChangelogEntry,
  shouldPublish,
  transformChangelogContent,
  type WorkspacePackage,
} from './changesets'

describe('filterPendingChangesets', () => {
  test('returns empty array when no files', () => {
    expect(filterPendingChangesets([])).toEqual([])
  })

  test('filters out README.md', () => {
    expect(filterPendingChangesets(['README.md'])).toEqual([])
  })

  test('returns only .md files that are not README.md', () => {
    const files = ['README.md', 'funny-turtle.md', 'brave-lion.md']
    expect(filterPendingChangesets(files)).toEqual(['funny-turtle.md', 'brave-lion.md'])
  })

  test('filters out non-.md files', () => {
    const files = ['funny-turtle.md', 'config.json', 'notes.txt']
    expect(filterPendingChangesets(files)).toEqual(['funny-turtle.md'])
  })

  test('handles mix of everything', () => {
    const files = ['README.md', 'funny-turtle.md', 'config.json', 'brave-lion.md', '.gitkeep']
    expect(filterPendingChangesets(files)).toEqual(['funny-turtle.md', 'brave-lion.md'])
  })
})

describe('shouldPublish', () => {
  test('returns true when no pending changesets', () => {
    expect(shouldPublish([])).toBe(true)
  })

  test('returns false when there are pending changesets', () => {
    expect(shouldPublish(['funny-turtle.md'])).toBe(false)
  })

  test('returns false when multiple pending changesets', () => {
    expect(shouldPublish(['funny-turtle.md', 'brave-lion.md'])).toBe(false)
  })
})

describe('hasUnpublishedVersions', () => {
  const mockNpm = (registry: Record<string, string>) => {
    return async (pkg: string): Promise<string | null> => registry[pkg] ?? null
  }

  test('returns false when all versions match npm', async () => {
    const packages: WorkspacePackage[] = [
      { name: '@agent-facets/core', version: '0.1.1', dir: 'packages/core' },
      { name: 'agent-facets', version: '0.1.1', dir: 'packages/cli' },
    ]
    const result = await hasUnpublishedVersions(
      packages,
      mockNpm({ '@agent-facets/core': '0.1.1', 'agent-facets': '0.1.1' }),
    )
    expect(result).toBe(false)
  })

  test('returns true when one version is ahead of npm', async () => {
    const packages: WorkspacePackage[] = [
      { name: '@agent-facets/core', version: '0.2.0', dir: 'packages/core' },
      { name: 'agent-facets', version: '0.1.1', dir: 'packages/cli' },
    ]
    const result = await hasUnpublishedVersions(
      packages,
      mockNpm({ '@agent-facets/core': '0.1.1', 'agent-facets': '0.1.1' }),
    )
    expect(result).toBe(true)
  })

  test('returns true when package is not on npm yet', async () => {
    const packages: WorkspacePackage[] = [{ name: '@agent-facets/brand', version: '0.1.0', dir: 'packages/brand' }]
    const result = await hasUnpublishedVersions(packages, mockNpm({}))
    expect(result).toBe(true)
  })

  test('includes private packages in version check', async () => {
    const packages: WorkspacePackage[] = [
      { name: 'private-pkg', version: '1.0.0', dir: 'packages/private', private: true },
      { name: '@agent-facets/core', version: '0.1.1', dir: 'packages/core' },
    ]
    const result = await hasUnpublishedVersions(packages, mockNpm({ '@agent-facets/core': '0.1.1' }))
    expect(result).toBe(true)
  })

  test('returns false for empty package list', async () => {
    const result = await hasUnpublishedVersions([], mockNpm({}))
    expect(result).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// transformChangelogContent
// ---------------------------------------------------------------------------

describe('transformChangelogContent', () => {
  /** Builds a remark-style attributed line (3-space indent, loose list) as @changesets/changelog-github generates */
  const remark = (hash: string, user: string, desc: string) =>
    `-   [\`${hash}\`](https://github.com/agent-facets/facets/commit/${hash}) Thanks [@${user}](https://github.com/${user})! - ${desc}`

  describe('attribution regex', () => {
    test('7-character commit hash', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('098fd08', 'eXamadeus', 'Fix a bug')}
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        - 098fd08 Thanks @eXamadeus! - Fix a bug
      `}\n`,
      )
    })

    test('8-character commit hash', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('abcdef01', 'user', 'Longer hash')}
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        - abcdef01 Thanks @user! - Longer hash
      `}\n`,
      )
    })

    test('full 40-character commit hash', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('a'.repeat(40), 'user', 'Full hash')}
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        - aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa Thanks @user! - Full hash
      `}\n`,
      )
    })

    test('username with mixed case, numbers, and hyphens', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('abc1234', 'eXamadeus', 'Mixed case')}

          ${remark('def5678', 'my-user-name', 'Hyphenated')}
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        - abc1234 Thanks @eXamadeus! - Mixed case
        - def5678 Thanks @my-user-name! - Hyphenated
      `}\n`,
      )
    })

    test('description with special characters', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('abc1234', 'user', 'Fix `foo()` in @scope/bar')}
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        - abc1234 Thanks @user! - Fix \`foo()\` in @scope/bar
      `}\n`,
      )
    })

    test('bare commit hash entry (no Thanks attribution)', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          -   bb87748: Just a bare commit hash entry
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        - bb87748: Just a bare commit hash entry
      `}\n`,
      )
    })

    test('Updated dependencies line', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          -   Updated dependencies [abc1234]
              -   @agent-facets/core@0.2.0
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        #### Updated Dependencies
        - abc1234 @agent-facets/core@0.2.0
      `}\n`,
      )
    })
  })

  describe('spacing normalization', () => {
    test('removes blank lines between loose list items', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('aaa1111', 'alice', 'Change A')}

          ${remark('bbb2222', 'bob', 'Change B')}
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        - aaa1111 Thanks @alice! - Change A
        - bbb2222 Thanks @bob! - Change B
      `}\n`,
      )
    })

    test('normalizes remark 3-space indent back to 1 space', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          -   bb87748: Bare entry
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        - bb87748: Bare entry
      `}\n`,
      )
    })
  })

  describe('user grouping', () => {
    test('groups multiple changes from the same user under a heading', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('aaa1111', 'eXamadeus', 'Change A')}

          ${remark('bbb2222', 'eXamadeus', 'Change B')}

          ${remark('ccc3333', 'eXamadeus', 'Change C')}
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        **@eXamadeus** — Thanks! (3 changes)
        - aaa1111 Change A
        - bbb2222 Change B
        - ccc3333 Change C
      `}\n`,
      )
    })

    test('sorts groups by volume descending', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('aaa1111', 'alice', 'A1')}

          ${remark('bbb2222', 'bob', 'B1')}

          ${remark('ccc3333', 'bob', 'B2')}

          ${remark('ddd4444', 'bob', 'B3')}

          ${remark('eee5555', 'alice', 'A2')}
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        **@bob** — Thanks! (3 changes)
        - bbb2222 B1
        - ccc3333 B2
        - ddd4444 B3

        **@alice** — Thanks! (2 changes)
        - aaa1111 A1
        - eee5555 A2
      `}\n`,
      )
    })

    test('preserves first-seen order for ties', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('aaa1111', 'alice', 'A1')}

          ${remark('bbb2222', 'alice', 'A2')}

          ${remark('ccc3333', 'bob', 'B1')}

          ${remark('ddd4444', 'bob', 'B2')}
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        **@alice** — Thanks! (2 changes)
        - aaa1111 A1
        - bbb2222 A2

        **@bob** — Thanks! (2 changes)
        - ccc3333 B1
        - ddd4444 B2
      `}\n`,
      )
    })

    test('single-change users keep original format (no grouping)', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('aaa1111', 'alice', 'Solo change')}
        `),
      ).toBe(
        `${dedent`
          ### Patch Changes
  
          - aaa1111 Thanks @alice! - Solo change
        `}\n`,
      )
    })

    test('groups + singles shows Individual Contributions heading', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('aaa1111', 'eXamadeus', 'Change A')}

          ${remark('bbb2222', 'eXamadeus', 'Change B')}

          ${remark('ccc3333', 'contributor', 'Solo fix')}
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        **@eXamadeus** — Thanks! (2 changes)
        - aaa1111 Change A
        - bbb2222 Change B

        #### Individual Contributions
        - ccc3333 Thanks @contributor! - Solo fix
      `}\n`,
      )
    })

    test('all multi-change users: no Individual Contributions heading', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('aaa1111', 'alice', 'A1')}

          ${remark('bbb2222', 'alice', 'A2')}

          ${remark('ccc3333', 'bob', 'B1')}

          ${remark('ddd4444', 'bob', 'B2')}
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        **@alice** — Thanks! (2 changes)
        - aaa1111 A1
        - bbb2222 A2

        **@bob** — Thanks! (2 changes)
        - ccc3333 B1
        - ddd4444 B2
      `}\n`,
      )
    })

    test('all single-change users: no heading, no grouping', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('aaa1111', 'alice', 'Solo A')}

          ${remark('bbb2222', 'bob', 'Solo B')}

          ${remark('ccc3333', 'charlie', 'Solo C')}
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        - aaa1111 Thanks @alice! - Solo A
        - bbb2222 Thanks @bob! - Solo B
        - ccc3333 Thanks @charlie! - Solo C
      `}\n`,
      )
    })
  })

  describe('Updated Dependencies', () => {
    test('multiple deps with commit hashes', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          -   Updated dependencies [bb87748]
          -   Updated dependencies [95e2f38]
              -   @agent-facets/brand@0.1.1
              -   @agent-facets/core@0.1.2
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        #### Updated Dependencies
        - 95e2f38 @agent-facets/brand@0.1.1
        - 95e2f38 @agent-facets/core@0.1.2
      `}\n`,
      )
    })

    test('deps after attributed changes', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('aaa1111', 'alice', 'Fix thing')}

          -   Updated dependencies [bb87748]
              -   @agent-facets/core@0.1.2
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        - aaa1111 Thanks @alice! - Fix thing

        #### Updated Dependencies
        - bb87748 @agent-facets/core@0.1.2
      `}\n`,
      )
    })
  })

  describe('mixed content', () => {
    test('attributed + unattributed + dependencies', () => {
      expect(
        transformChangelogContent(dedent`
          ### Patch Changes

          ${remark('aaa1111', 'eXamadeus', 'Change A')}

          ${remark('bbb2222', 'eXamadeus', 'Change B')}

          -   cc87748: Bare commit entry

          ${remark('ddd4444', 'contributor', 'Solo fix')}

          -   Updated dependencies [ee12345]
              -   @agent-facets/core@0.2.0
        `),
      ).toBe(
        `${dedent`
        ### Patch Changes

        **@eXamadeus** — Thanks! (2 changes)
        - aaa1111 Change A
        - bbb2222 Change B

        #### Individual Contributions
        - ddd4444 Thanks @contributor! - Solo fix
        - cc87748: Bare commit entry

        #### Updated Dependencies
        - ee12345 @agent-facets/core@0.2.0
      `}\n`,
      )
    })

    test('multiple ### sections (Minor + Patch)', () => {
      expect(
        transformChangelogContent(dedent`
          ### Minor Changes

          ${remark('aaa1111', 'alice', 'New feature')}

          ### Patch Changes

          ${remark('bbb2222', 'bob', 'Bug fix')}
        `),
      ).toBe(
        `${dedent`
        ### Minor Changes

        - aaa1111 Thanks @alice! - New feature

        ### Patch Changes

        - bbb2222 Thanks @bob! - Bug fix
      `}\n`,
      )
    })

    test('empty content', () => {
      expect(transformChangelogContent('')).toBe('\n')
    })
  })
})

// ---------------------------------------------------------------------------
// replaceChangelogEntry
// ---------------------------------------------------------------------------

describe('replaceChangelogEntry', () => {
  test('replaces the latest version entry', () => {
    expect(
      replaceChangelogEntry(
        dedent`
          # @agent-facets/core

          ## 0.2.0

          ### Patch Changes

          - Old content here

          ## 0.1.0

          ### Minor Changes

          - Initial release
        `,
        '0.2.0',
        `${dedent`
          ### Patch Changes

          - New clean content
        `}\n`,
      ),
    ).toBe(dedent`
      # @agent-facets/core

      ## 0.2.0

      ### Patch Changes

      - New clean content

      ## 0.1.0

      ### Minor Changes

      - Initial release
    `)
  })

  test('entry at end of file (no subsequent version)', () => {
    expect(
      replaceChangelogEntry(
        dedent`
          # pkg

          ## 1.0.0

          ### Patch Changes

          - Old stuff
        `,
        '1.0.0',
        `${dedent`
          ### Patch Changes

          - New stuff
        `}\n`,
      ),
    ).toBe(
      `${dedent`
      # pkg

      ## 1.0.0

      ### Patch Changes

      - New stuff
    `}\n`,
    )
  })

  test('returns unchanged when version not found', () => {
    const changelog = dedent`
      # pkg

      ## 1.0.0

      - stuff
    `
    expect(replaceChangelogEntry(changelog, '9.9.9', 'new content')).toBe(changelog)
  })

  test('preserves surrounding versions', () => {
    expect(
      replaceChangelogEntry(
        dedent`
          # my-package

          ## 0.3.0

          - v0.3 stuff

          ## 0.2.0

          - v0.2 stuff

          ## 0.1.0

          - v0.1 stuff
        `,
        '0.2.0',
        '- replaced v0.2\n',
      ),
    ).toBe(dedent`
      # my-package

      ## 0.3.0

      - v0.3 stuff

      ## 0.2.0

      - replaced v0.2

      ## 0.1.0

      - v0.1 stuff
    `)
  })
})

// ---------------------------------------------------------------------------
// buildVersionPrBody
// ---------------------------------------------------------------------------

describe('buildVersionPrBody', () => {
  const sampleChangelog = `# @agent-facets/core

## 0.2.0

### Minor Changes

- Added a cool new feature

### Patch Changes

- Fixed a bug

## 0.1.0

### Minor Changes

- Initial release
`

  const mockReadFile = (files: Record<string, string>) => {
    return async (path: string): Promise<string> => {
      const content = files[path]
      if (!content) throw new Error(`File not found: ${path}`)
      return content
    }
  }

  test('generates PR body with release sections', async () => {
    const { body } = await buildVersionPrBody(
      [{ name: '@agent-facets/core', version: '0.2.0', dir: 'packages/core' }],
      mockReadFile({ 'packages/core/CHANGELOG.md': sampleChangelog }),
    )

    expect(body).toContain('# Releases')
    expect(body).toContain('## @agent-facets/core@0.2.0')
    expect(body).toContain('Added a cool new feature')
    expect(body).toContain('Fixed a bug')
    // Should not include content from older versions
    expect(body).not.toContain('Initial release')
  })

  test('includes header message', async () => {
    const { body } = await buildVersionPrBody(
      [{ name: '@agent-facets/core', version: '0.2.0', dir: 'packages/core' }],
      mockReadFile({ 'packages/core/CHANGELOG.md': sampleChangelog }),
    )

    expect(body).toContain('auto-generated by the release workflow')
    expect(body).toContain('packages will be published to npm automatically')
  })

  test('handles multiple packages', async () => {
    const cliChangelog = `# agent-facets

## 0.3.0

### Minor Changes

- New CLI command
`
    const { body } = await buildVersionPrBody(
      [
        { name: '@agent-facets/core', version: '0.2.0', dir: 'packages/core' },
        { name: 'agent-facets', version: '0.3.0', dir: 'packages/cli' },
      ],
      mockReadFile({
        'packages/core/CHANGELOG.md': sampleChangelog,
        'packages/cli/CHANGELOG.md': cliChangelog,
      }),
    )

    expect(body).toContain('## @agent-facets/core@0.2.0')
    expect(body).toContain('## agent-facets@0.3.0')
    expect(body).toContain('New CLI command')

    // agent-facets should appear before @agent-facets/core (explicit ordering)
    const cliIndex = body.indexOf('## agent-facets@0.3.0')
    const coreIndex = body.indexOf('## @agent-facets/core@0.2.0')
    expect(cliIndex).toBeLessThan(coreIndex)
  })

  test('orders packages: agent-facets > core > brand', async () => {
    const makeChangelog = (name: string, version: string) =>
      `${dedent`
        # ${name}

        ## ${version}

        ### Patch Changes

        - Updated ${name}
      `}\n`

    const { body } = await buildVersionPrBody(
      [
        { name: '@agent-facets/brand', version: '0.2.0', dir: 'packages/brand' },
        { name: '@agent-facets/core', version: '0.3.0', dir: 'packages/core' },
        { name: 'agent-facets', version: '0.4.0', dir: 'packages/cli' },
      ],
      mockReadFile({
        'packages/brand/CHANGELOG.md': makeChangelog('@agent-facets/brand', '0.2.0'),
        'packages/core/CHANGELOG.md': makeChangelog('@agent-facets/core', '0.3.0'),
        'packages/cli/CHANGELOG.md': makeChangelog('agent-facets', '0.4.0'),
      }),
    )

    const cliIdx = body.indexOf('## agent-facets@0.4.0')
    const coreIdx = body.indexOf('## @agent-facets/core@0.3.0')
    const brandIdx = body.indexOf('## @agent-facets/brand@0.2.0')

    expect(cliIdx).toBeLessThan(coreIdx)
    expect(coreIdx).toBeLessThan(brandIdx)
  })

  test('truncates when body exceeds 60K characters', async () => {
    const longContent = 'x'.repeat(70_000)
    const hugeChangelog = `${dedent`
        # pkg

        ## 1.0.0

        ### Patch Changes

        - ${longContent}
      `}\n`

    const { body } = await buildVersionPrBody(
      [{ name: 'huge-pkg', version: '1.0.0', dir: 'packages/huge' }],
      mockReadFile({ 'packages/huge/CHANGELOG.md': hugeChangelog }),
    )

    expect(body.length).toBeLessThanOrEqual(60_000)
    expect(body).toContain('omitted from this message')
  })

  test('returns per-package entries for CHANGELOG rewrite', async () => {
    const { entries } = await buildVersionPrBody(
      [{ name: '@agent-facets/core', version: '0.2.0', dir: 'packages/core' }],
      mockReadFile({ 'packages/core/CHANGELOG.md': sampleChangelog }),
    )

    expect(entries).toHaveLength(1)
    expect(entries[0]).toEqual(
      expect.objectContaining({
        dir: 'packages/core',
        version: '0.2.0',
      }),
    )
    expect(entries[0]?.content).toContain('Added a cool new feature')
  })

  test('applies transform to entry content (removes remark spacing)', async () => {
    // Changelog with remark-style loose list items
    const remarkChangelog = `# pkg

## 1.0.0

### Patch Changes

-   First change

-   Second change
`
    const { body } = await buildVersionPrBody(
      [{ name: 'test-pkg', version: '1.0.0', dir: 'packages/test' }],
      mockReadFile({ 'packages/test/CHANGELOG.md': remarkChangelog }),
    )

    // Should have tight spacing, not loose
    expect(body).toContain('- First change\n- Second change')
  })
})

// ---------------------------------------------------------------------------
// parsePublishedPackages
// ---------------------------------------------------------------------------

describe('parsePublishedPackages', () => {
  test('parses scoped package tags', () => {
    const stdout = `
info npm info @agent-facets/core
New tag:  @agent-facets/core@0.1.3
New tag:  agent-facets@0.1.4
info All packages published
`
    const result = parsePublishedPackages(stdout)
    expect(result).toEqual([
      { name: '@agent-facets/core', version: '0.1.3' },
      { name: 'agent-facets', version: '0.1.4' },
    ])
  })

  test('returns empty array when no tags found', () => {
    const stdout = 'Some random output\nNo packages to publish'
    expect(parsePublishedPackages(stdout)).toEqual([])
  })

  test('returns empty array for empty string', () => {
    expect(parsePublishedPackages('')).toEqual([])
  })

  test('handles single-package repo format', () => {
    const stdout = 'New tag:  v1.2.3'
    // The regex expects name@version, v1.2.3 doesn't match that pattern
    // In a single-package repo, the tag format is different
    expect(parsePublishedPackages(stdout)).toEqual([])
  })

  test('handles mixed output with noise', () => {
    const stdout = `
Running: npm publish --access public
@agent-facets/core@0.2.0
packages published successfully:
@agent-facets/core@0.2.0
Creating git tags...
New tag:  @agent-facets/core@0.2.0
`
    const result = parsePublishedPackages(stdout)
    expect(result).toEqual([{ name: '@agent-facets/core', version: '0.2.0' }])
  })
})

// ---------------------------------------------------------------------------
// comparePackageOrder
// ---------------------------------------------------------------------------

describe('comparePackageOrder', () => {
  test('sorts known packages into their defined order', () => {
    const scrambled = ['@agent-facets/brand', '@agent-facets/core', 'agent-facets']
    const sorted = [...scrambled].sort(comparePackageOrder)
    expect(sorted).toEqual(['agent-facets', '@agent-facets/core', '@agent-facets/brand'])
  })

  test('unknown packages sort after known ones', () => {
    const packages = ['unknown-pkg', '@agent-facets/core', 'agent-facets', 'another-unknown']
    const sorted = [...packages].sort(comparePackageOrder)
    expect(sorted[0]).toBe('agent-facets')
    expect(sorted[1]).toBe('@agent-facets/core')
    // Unknown packages are equal to each other, so they end up after the known ones
    // but their relative order is unspecified
    expect(sorted.slice(2).sort()).toEqual(['another-unknown', 'unknown-pkg'])
  })

  test('all unknown packages preserve stable order', () => {
    const packages = ['zebra', 'alpha', 'middle']
    const sorted = [...packages].sort(comparePackageOrder)
    // All have MAX_SAFE_INTEGER order, so comparator returns 0 — stable sort preserves input order
    expect(sorted).toEqual(['zebra', 'alpha', 'middle'])
  })

  test('single package is unchanged', () => {
    const packages = ['@agent-facets/core']
    const sorted = [...packages].sort(comparePackageOrder)
    expect(sorted).toEqual(['@agent-facets/core'])
  })

  test('already-sorted input stays sorted', () => {
    const packages = ['agent-facets', '@agent-facets/core', '@agent-facets/brand']
    const sorted = [...packages].sort(comparePackageOrder)
    expect(sorted).toEqual(packages)
  })
})
