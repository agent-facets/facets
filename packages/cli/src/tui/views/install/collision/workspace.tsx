import type { CollisionResolution, CollisionResolutionRequest } from '@agent-facets/engine'
import type { MaterializationDisposition } from '@agent-facets/protocol'
import { Box, Text, useInput } from 'ink'
import { useCallback, useMemo, useState } from 'react'
import { THEME } from '../../../theme.ts'
import { COLLISION_STATUS } from '../collision-status.ts'
import { CHOICES, type ChoiceKind, ClaimantRow, choiceOf, StatusTag } from './claimant-row.tsx'
import {
  type ClaimantModel,
  type CollisionDraft,
  createDraft,
  type DisplayGroup,
  draftOverrides,
  evaluateDraft,
  reviseDraft,
} from './draft.ts'

/**
 * The interactive collision workspace: an overview of every group, and a
 * focused editor for one group at a time.
 *
 * Two decisions shape it.
 *
 * **One draft, always global.** Every edit re-plans the COMPLETE desired
 * set, not just the group on screen. That is what lets a user alias onto
 * a name nothing was fighting over, and see instantly that they have
 * merely moved the conflict. A per-group model would have accepted that
 * edit and failed at install time.
 *
 * **Temporary conflict is a legal state.** The user may leave a group
 * yellow, walk to the other claimant, and fix it from that side instead.
 * Refusing to record a conflicting choice would force people to solve
 * conflicts in the one order the tool happened to prefer.
 */
export function CollisionWorkspace({
  request,
  onComplete,
}: {
  request: CollisionResolutionRequest
  /** Settles the engine's pending resolver call. Called exactly once. */
  onComplete: (resolution: CollisionResolution) => void
}) {
  const [draft, setDraft] = useState<CollisionDraft>(() => createDraft(request))
  const [view, setView] = useState<View>({ kind: 'overview', index: 0 })
  const [editing, setEditing] = useState<{ key: string; value: string } | null>(null)

  const model = useMemo(() => evaluateDraft(request, draft), [request, draft])
  const { groups, confirmable } = model

  const activeGroup = view.kind === 'group' ? findGroup(groups, view.anchor) : null
  // A group always has at least two members, but the index signature
  // cannot say so; normalize to null so the narrowing below is real.
  const focusedMember: ClaimantModel | null = activeGroup
    ? (findMember(activeGroup, view) ?? activeGroup.members[0] ?? null)
    : null

  const revise = useCallback(
    (claimant: ClaimantModel, disposition: MaterializationDisposition) => {
      setDraft((current) => reviseDraft(request, current, claimant, disposition))
    },
    [request],
  )

  const openAlias = useCallback((claimant: ClaimantModel) => {
    setEditing({
      key: claimant.key,
      // Seed from the current alias so a small correction is a small
      // edit, and from the authored name otherwise so the user starts
      // from the thing they are renaming.
      value: claimant.disposition.kind === 'aliased' ? claimant.disposition.as : claimant.authoredName,
    })
  }, [])

  const chooseFor = useCallback(
    (claimant: ClaimantModel, choice: ChoiceKind) => {
      switch (choice) {
        case 'keep':
          revise(claimant, { kind: 'authored' })
          return
        case 'omit':
          revise(claimant, { kind: 'omitted' })
          return
        case 'alias':
          // Deliberately does NOT write the draft yet: an alias is not a
          // decision until it has a name, and committing the authored
          // name as an "alias" would be a lie the lockfile would record.
          openAlias(claimant)
          return
      }
    },
    [revise, openAlias],
  )

  useInput(
    (input, key) => {
      if (key.ctrl && input === 'c') {
        onComplete({ kind: 'cancelled' })
        return
      }

      if (view.kind === 'overview') {
        const rows = groups.length + 1 // groups, then the confirm row
        if (key.escape) {
          onComplete({ kind: 'cancelled' })
          return
        }
        if (key.downArrow || (key.tab && !key.shift)) {
          setView({ kind: 'overview', index: Math.min(view.index + 1, rows - 1) })
          return
        }
        if (key.upArrow || (key.tab && key.shift)) {
          setView({ kind: 'overview', index: Math.max(view.index - 1, 0) })
          return
        }
        if (key.return) {
          const group = groups[view.index]
          if (group !== undefined) {
            const first = group.members[0]
            if (first !== undefined) {
              setView({ kind: 'group', anchor: first.key, focus: first.key, highlight: choiceOf(first) })
            }
            return
          }
          if (confirmable) onComplete({ kind: 'resolved', overrides: draftOverrides(draft) })
        }
        return
      }

      if (activeGroup === null || focusedMember === null) return

      if (key.escape) {
        setView({ kind: 'overview', index: indexOfGroup(groups, activeGroup) })
        return
      }
      if (key.downArrow || (key.tab && !key.shift)) {
        setView(moveFocus(view, activeGroup, 1))
        return
      }
      if (key.upArrow || (key.tab && key.shift)) {
        setView(moveFocus(view, activeGroup, -1))
        return
      }
      if (key.leftArrow || key.rightArrow) {
        // Move the cursor only. Applying on arrow would open the alias
        // editor the instant the cursor passed over Alias, and the
        // editor captures every subsequent key — so Omit, which sits
        // beyond it, could never be reached.
        const current = CHOICES.indexOf(view.highlight)
        const next = CHOICES[clamp(current + (key.rightArrow ? 1 : -1), 0, CHOICES.length - 1)]
        if (next !== undefined) setView({ ...view, highlight: next })
        return
      }
      if (key.return) {
        chooseFor(focusedMember, view.highlight)
      }
    },
    { isActive: editing === null },
  )

  if (activeGroup !== null && focusedMember !== null) {
    return (
      <GroupView
        group={activeGroup}
        focused={focusedMember}
        highlight={view.kind === 'group' ? view.highlight : choiceOf(focusedMember)}
        editing={editing}
        onAliasChange={(value) => setEditing((current) => (current === null ? null : { ...current, value }))}
        onAliasSubmit={(alias) => {
          revise(focusedMember, { kind: 'aliased', as: alias })
          setEditing(null)
        }}
        onAliasCancel={() => setEditing(null)}
      />
    )
  }

  return <Overview model={model} index={view.kind === 'overview' ? view.index : 0} />
}

type View =
  | { kind: 'overview'; index: number }
  /**
   * `anchor` selects the group by a claimant rather than a group id,
   * because group identity is not stable: aliasing across groups merges
   * two of them, and a merge would otherwise strand the user on a group
   * that no longer exists. A claimant, once surfaced, never disappears.
   */
  | { kind: 'group'; anchor: string; focus: string; highlight: ChoiceKind }

function Overview({ model, index }: { model: ReturnType<typeof evaluateDraft>; index: number }) {
  const { groups, confirmable, staleOverrides } = model
  const unresolved = groups.filter((group) => group.status !== 'resolved').length

  return (
    <Box flexDirection="column">
      <Text bold color={THEME.brand}>
        Installation is paused: two or more facets want the same name.
      </Text>
      <Text color={THEME.hint}>
        {groups.length} group{groups.length === 1 ? '' : 's'} · {unresolved} still to resolve · nothing has been written
        yet
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {groups.map((group, groupIndex) => (
          <Box key={group.key} flexDirection="column">
            <Text>
              <Text color={groupIndex === index ? THEME.focus : THEME.hint}>{groupIndex === index ? '▸ ' : '  '}</Text>
              <StatusTagFor status={group.status} />
              <Text bold> {group.contested.length > 0 ? group.contested.join(', ') : group.origin}</Text>
              <Text color={THEME.hint}>
                {' '}
                ({group.members.length} asset{group.members.length === 1 ? '' : 's'})
              </Text>
            </Text>
            {group.members.map((member) => (
              <Text key={member.key} color={THEME.hint}>
                {'      '}
                {member.facet} {member.type} {member.authoredName}
                {member.effectiveName === null ? ' — omitted' : ` → ${member.effectiveName}`}
              </Text>
            ))}
          </Box>
        ))}
      </Box>

      {staleOverrides.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          {staleOverrides.map((stale) => (
            <Text key={`${stale.facet}:${stale.type}:${stale.authoredName}`} color={THEME.caution}>
              ⚠ {stale.facet} has a leftover choice for {stale.type} {stale.authoredName}, which this version no longer
              contains.
            </Text>
          ))}
        </Box>
      )}

      <Box marginTop={1}>
        <Text color={index === model.groups.length ? THEME.focus : THEME.hint}>
          {index === model.groups.length ? '▸ ' : '  '}
        </Text>
        <Text color={confirmable ? THEME.success : THEME.hint} bold={confirmable} dimColor={!confirmable}>
          [ Confirm and continue installing ]
        </Text>
        {!confirmable && <Text color={THEME.hint}> — resolve every group first</Text>}
      </Box>

      <Text color={THEME.hint}>↑↓ move · Enter open · Esc cancel</Text>
    </Box>
  )
}

function GroupView({
  group,
  focused,
  highlight,
  editing,
  onAliasChange,
  onAliasSubmit,
  onAliasCancel,
}: {
  group: DisplayGroup
  focused: ClaimantModel
  highlight: ChoiceKind
  editing: { key: string; value: string } | null
  onAliasChange: (value: string) => void
  onAliasSubmit: (alias: string) => void
  onAliasCancel: () => void
}) {
  return (
    <Box flexDirection="column">
      <Text bold color={THEME.brand}>
        {group.contested.length > 0 ? group.contested.join(', ') : group.origin}
      </Text>
      <Text color={THEME.hint}>
        {group.members.length} assets want this name. Give each one an outcome; they only have to differ from each
        other.
      </Text>

      <Box flexDirection="column" marginTop={1}>
        {group.members.map((member) => (
          <Box key={member.key} flexDirection="column" marginBottom={1}>
            <ClaimantRow
              claimant={member}
              focused={member.key === focused.key}
              highlight={member.key === focused.key ? highlight : null}
              editing={editing !== null && editing.key === member.key}
              aliasValue={editing !== null && editing.key === member.key ? editing.value : ''}
              onAliasChange={onAliasChange}
              onAliasSubmit={onAliasSubmit}
              onAliasCancel={onAliasCancel}
            />
            {member.conflictsWith.length > 0 && (
              <Text color={THEME.hint}>
                {'    '}still contested with{' '}
                {group.members
                  .filter((other) => member.conflictsWith.includes(other.key))
                  .map((other) => `${other.facet} ${other.authoredName}`)
                  .join(', ')}
              </Text>
            )}
          </Box>
        ))}
      </Box>

      <Text color={THEME.hint}>
        {editing === null ? '↑↓ move · ←→ choose · Enter apply · Esc back' : 'type a name · Esc cancel'}
      </Text>
    </Box>
  )
}

function StatusTagFor({ status }: { status: ClaimantModel['status'] }) {
  const presentation = COLLISION_STATUS[status]
  return (
    <Text color={presentation.color}>
      {presentation.icon} {presentation.label}
    </Text>
  )
}

function findGroup(groups: readonly DisplayGroup[], anchor: string): DisplayGroup | null {
  return groups.find((group) => group.members.some((member) => member.key === anchor)) ?? null
}

function findMember(group: DisplayGroup, view: View): ClaimantModel | undefined {
  if (view.kind !== 'group') return undefined
  return group.members.find((member) => member.key === view.focus)
}

function indexOfGroup(groups: readonly DisplayGroup[], group: DisplayGroup): number {
  const index = groups.findIndex((candidate) => candidate.key === group.key)
  return index === -1 ? 0 : index
}

function moveFocus(view: View, group: DisplayGroup, delta: number): View {
  if (view.kind !== 'group') return view
  const current = group.members.findIndex((member) => member.key === view.focus)
  const next = group.members[clamp(current + delta, 0, group.members.length - 1)]
  // The cursor follows the row it lands on, so arrowing down and back up
  // never silently re-points an option at a different claimant.
  return next === undefined ? view : { kind: 'group', anchor: view.anchor, focus: next.key, highlight: choiceOf(next) }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

export { StatusTag }
