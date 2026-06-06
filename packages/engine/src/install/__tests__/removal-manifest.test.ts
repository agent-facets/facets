import { describe, expect, test } from 'bun:test'
import { removalManifest } from '../removal-manifest.ts'

describe('removalManifest', () => {
  test('synthesizes a placeholder manifest carrying the facet name', () => {
    expect(removalManifest('cowsay')).toEqual({ name: 'cowsay', version: '0.0.0' })
  })

  test('uses the given name verbatim', () => {
    expect(removalManifest('viper-plans').name).toBe('viper-plans')
  })
})
