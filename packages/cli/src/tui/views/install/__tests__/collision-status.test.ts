import { describe, expect, test } from 'bun:test'
import { COLLISION_STATUS, type CollisionStatus, describeStatus } from '../collision-status.ts'

const ALL: CollisionStatus[] = ['unresolved', 'draft-conflict', 'resolved']

describe('collision status presentation', () => {
  test('every state has a distinct icon', () => {
    const icons = ALL.map((status) => COLLISION_STATUS[status].icon)
    expect(new Set(icons).size).toBe(ALL.length)
  })

  test('every state has a distinct word', () => {
    const labels = ALL.map((status) => COLLISION_STATUS[status].label)
    expect(new Set(labels).size).toBe(ALL.length)
  })

  test('every state has a distinct color', () => {
    // Color is the redundant channel, not the only one — but two states
    // sharing a color would still be a bug.
    const colors = ALL.map((status) => COLLISION_STATUS[status].color)
    expect(new Set(colors).size).toBe(ALL.length)
  })

  test('states stay distinguishable with color stripped', () => {
    // This is the actual accessibility promise: under NO_COLOR, in a
    // pipe, or for a red/green-colorblind reader, the rendered text
    // alone must still separate the three states.
    const rendered = ALL.map((status) => describeStatus(status))
    expect(new Set(rendered).size).toBe(ALL.length)
    expect(rendered).toEqual(['✕ unresolved', '⚠ conflict', '✓ resolved'])
  })
})
