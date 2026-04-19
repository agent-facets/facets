import { describe, expect, test } from 'bun:test'
import { type } from 'arktype'
import { type FacetsJson, FacetsJsonSchema } from '../schemas/project-manifest.ts'

describe('FacetsJsonSchema', () => {
  test('empty facets object is valid', () => {
    const input = { facets: {} }
    const result = FacetsJsonSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
  })

  test('string source specifiers pass through', () => {
    const input = {
      facets: {
        'viper-plans': 'github:agent-facets/viper-plans#main',
        'local-plans': 'file:./facets/local-plans',
        'git-plans': 'git+https://example.com/plans.git#v1.0.0',
      },
    }
    const result = FacetsJsonSchema(input)
    expect(result).not.toBeInstanceOf(type.errors)
    const data = result as FacetsJson
    expect(data.facets['viper-plans']).toBe('github:agent-facets/viper-plans#main')
  })

  test('missing facets field is rejected', () => {
    const result = FacetsJsonSchema({})
    expect(result).toBeInstanceOf(type.errors)
  })

  test('non-string source value is rejected', () => {
    const input = {
      facets: {
        'viper-plans': { source: 'github:a/b' },
      },
    }
    const result = FacetsJsonSchema(input)
    expect(result).toBeInstanceOf(type.errors)
  })
})
