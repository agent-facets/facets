import { describe, expect, test } from 'bun:test'
import { SUPPORTED_ADAPTER_APIS } from '@agent-facets/engine'
import { FacetManifestSchema } from '@agent-facets/protocol'
import { commands } from '../../../commands.ts'
import {
  DEFAULT_TOPIC,
  INSTRUCTION_TOPICS,
  isInstructionTopic,
  promptFor,
  renderAdapterApiSupportSet,
  renderTopicIndex,
  TOPICS,
} from '../../../prompts/index.ts'
import { ACCEPT_MCP_FLAG } from '../../shared/flags.ts'
import { updateCommand } from '../../update/index.ts'
import { instructionsCommand } from '../index.ts'

describe('instruction topics', () => {
  test('default topic is overview and has a non-empty prompt', () => {
    expect(DEFAULT_TOPIC).toBe('overview')
    expect(TOPICS.overview.prompt.length).toBeGreaterThan(0)
  })

  test('all four domain topics exist with a prompt and a summary', () => {
    expect(INSTRUCTION_TOPICS.sort()).toEqual(['authoring', 'manifest', 'overview', 'usage'])
    for (const topic of INSTRUCTION_TOPICS) {
      expect(TOPICS[topic].prompt.length).toBeGreaterThan(0)
      expect(TOPICS[topic].summary.length).toBeGreaterThan(0)
    }
  })

  test('isInstructionTopic narrows valid and rejects invalid', () => {
    expect(isInstructionTopic('authoring')).toBe(true)
    expect(isInstructionTopic('nope')).toBe(false)
  })
})

describe('topic index', () => {
  test('renders one line per topic, each with its invocation and summary', () => {
    const index = renderTopicIndex()
    expect(index).toContain('Instruction topics')
    for (const topic of INSTRUCTION_TOPICS) {
      expect(index).toContain(`facet instructions ${topic}`)
      expect(index).toContain(TOPICS[topic].summary)
    }
  })

  test('overview prompt substitutes the generated index before workflow routing', () => {
    const overview = promptFor('overview')
    // The marker must be replaced, not printed literally.
    expect(overview).not.toContain('{{TOPIC_INDEX}}')
    // Every topic is listed, and the index precedes the AUTHORING/USING routing.
    for (const topic of INSTRUCTION_TOPICS) {
      expect(overview).toContain(`facet instructions ${topic}`)
    }
    expect(overview.indexOf('Instruction topics')).toBeLessThan(overview.indexOf('AUTHORING a facet'))
  })

  test('no rendered prompt still carries an unsubstituted marker', () => {
    // Weaker than "returned verbatim", which stopped being true once a
    // second topic gained a generated value — but it tests the thing that
    // actually matters: a marker must never reach a reader.
    for (const topic of INSTRUCTION_TOPICS) {
      expect(promptFor(topic)).not.toContain('{{')
    }
  })

  test('prompts without markers are returned verbatim', () => {
    for (const topic of INSTRUCTION_TOPICS) {
      const raw = TOPICS[topic].prompt
      if (raw.includes('{{')) continue
      expect(promptFor(topic)).toBe(raw)
    }
  })
})

describe('0.29 guidance is present in the prompts', () => {
  test('authoring covers README default, --no-readme, top-level files, and verify', () => {
    const authoring = TOPICS.authoring.prompt
    expect(authoring).toContain('README.md')
    expect(authoring).toContain('--no-readme')
    expect(authoring).toContain('"files"')
    expect(authoring).toContain('facet build --verify')
  })

  test('manifest documents top-level and per-skill supplementary files', () => {
    const manifest = TOPICS.manifest.prompt
    expect(manifest).toContain('files')
    expect(manifest).toContain('archive-only')
    expect(manifest).toContain('companion')
    // The generated-schema marker must be preserved for the append step.
    expect(manifest).toContain('--- JSON Schema (generated) ---')
  })

  test('usage covers adapter SDK API recovery guidance for the whole support set', () => {
    // Rendered, not raw: the support set is generated from engine's single
    // declaration, so asserting the raw prompt would only prove a marker
    // exists — and asserting a literal would be the duplication the marker
    // was introduced to remove.
    const usage = promptFor('usage')
    expect(usage).toContain(`adapter SDK API ${renderAdapterApiSupportSet()}`)
    for (const api of SUPPORTED_ADAPTER_APIS) {
      expect(usage).toContain(api)
    }
    expect(usage).toContain('facet adapter list')
  })
})

describe('materialization guidance is present in the prompts', () => {
  // An agent that believes facets.json is a flat name -> string map will
  // silently destroy any recorded alias or omission the moment it rewrites
  // the file. The prompt is the only thing standing between that belief and
  // a user's project, so assert it teaches both entry forms.
  test('usage documents the expanded facets.json entry form', () => {
    const usage = TOPICS.usage.prompt
    expect(usage).toContain('manifestVersion')
    expect(usage).toContain('"materialization"')
    expect(usage).toContain('handle BOTH forms')
  })

  test('usage teaches the non-TTY collision remedy', () => {
    const usage = TOPICS.usage.prompt
    expect(usage).toContain('"kind": "aliased"')
    expect(usage).toContain('"kind": "omitted"')
    // Recording an explicit authored disposition is rejected by the schema,
    // so the prompt must not present it as an option.
    expect(usage).toContain('Do NOT write')
    expect(usage).toContain('"skills", "agents", "commands", and "servers"')
  })

  // An agent without a TTY that meets an MCP declaration has exactly two ways
  // to finish. Naming neither leaves it stuck at a hard failure, so the prompt
  // must carry both -- and must not imply the flag settles asset questions too.
  test('usage teaches both non-TTY MCP remedies', () => {
    const usage = TOPICS.usage.prompt
    expect(usage).toContain('--accept-mcp')
    expect(usage).toContain('"servers": { "docs": { "kind": "omitted" } }')
    expect(usage).toContain('"manifestVersion": 0.2')
    expect(usage).toContain('MACHINE-LOCAL')
  })

  test('usage does not present --accept-mcp as an asset remedy', () => {
    const usage = TOPICS.usage.prompt
    expect(usage).toContain('does NOT resolve an')
    expect(usage).toContain('There is no CLI flag for collisions')
  })

  // The declaration objects are closed, which contradicts the tolerance rule
  // stated for the rest of the manifest -- an author following the general
  // rule would ship a manifest that fails validation.
  test('authoring teaches the closed server declaration shapes', () => {
    const authoring = TOPICS.authoring.prompt
    expect(authoring).toContain('"type": "stdio"')
    expect(authoring).toContain('"type": "http"')
    expect(authoring).toContain('CLOSED')
    expect(authoring).toContain('NEVER put a secret')
  })

  test('usage does not claim facets.json is a flat string map', () => {
    expect(TOPICS.usage.prompt).not.toContain('map of facet name to source specifier')
  })

  test('usage does not steer agents away from the only non-TTY remedy', () => {
    // Hand-editing facets.json is the sole way to record an alias without a
    // TTY -- there is no --as or --omit flag on any command.
    expect(TOPICS.usage.prompt).not.toContain('You generally do not hand-edit it')
  })

  test('authoring warns that authored names may not land verbatim', () => {
    const authoring = TOPICS.authoring.prompt
    expect(authoring).toContain('AUTHORED name')
    expect(authoring).toContain('omit it entirely')
  })

  test('overview command index covers the project-management commands', () => {
    const overview = TOPICS.overview.prompt
    for (const command of ['facet install', 'facet update', 'facet remove', 'facet list', 'facet publish']) {
      expect(overview).toContain(command)
    }
  })

  // The index is hand-written on purpose: its descriptions are aimed at an
  // agent and differ from the registry's own `description`. What is NOT
  // deliberate is a command shipping without ever reaching this list --
  // which is exactly how `facet update` was missing from it. Derive the
  // expectation from the registry so the next one cannot repeat it.
  test('every implemented command reaches the overview index', () => {
    // Covered inline on the `facet login` line rather than by their own
    // entries, because they are one authentication story.
    const coveredInline = new Set(['logout', 'whoami'])
    const overview = TOPICS.overview.prompt
    for (const [name, command] of Object.entries(commands)) {
      if (command.implemented !== true) continue
      if (coveredInline.has(name)) {
        expect(overview).toContain(name)
        continue
      }
      expect(overview).toContain(`facet ${name}`)
    }
  })
})

describe('update guidance is present in the prompts', () => {
  test('overview names update, its alias, and what it is not', () => {
    const overview = TOPICS.overview.prompt
    expect(overview).toContain('facet update')
    expect(overview).toContain('facet upgrade')
    // The whole point of the pairing: one moves facets, the other moves
    // the binary, and an agent that confuses them does the wrong thing.
    expect(overview).toContain('facet self-update')
    expect(overview).toContain('CLI binary')
  })

  test('overview names the alias from the command declaration, not a guess', () => {
    for (const alias of updateCommand.aliases ?? []) {
      expect(TOPICS.overview.prompt).toContain(`facet ${alias}`)
    }
  })

  test('usage covers both modes, the preview, and the TTY refusal', () => {
    const usage = TOPICS.usage.prompt
    expect(usage).toContain('facet update --latest')
    expect(usage).toContain('facet update --dry-run')
    expect(usage).toContain('--interactive')
    // An agent must be told not to reach for the screen it cannot use.
    expect(usage).toContain('REQUIRES a real terminal')
  })

  test('usage gives the recovery path for a project that cannot be checked', () => {
    const usage = TOPICS.usage.prompt
    expect(usage).toContain('cannot be checked for updates yet')
    expect(usage).toContain('facet install')
    // A stale plan is not damage, and an agent that treats it as damage
    // will go looking for a file to repair.
    expect(usage).toContain('Nothing is broken')
  })

  test('usage names the one no-op that has a next step', () => {
    expect(TOPICS.usage.prompt).toContain('ranges in facets.json permit none of them')
  })

  test('usage lists update among the commands that accept the MCP flag', () => {
    // Sourced from the flag constant: the prompt and the remedy the CLI
    // prints on failure have to be the same string.
    expect(TOPICS.usage.prompt).toContain(`facet update --${ACCEPT_MCP_FLAG}`)
  })

  test('usage does not restate the version specifier grammar a second time', () => {
    // The forms are taught once, under `facet add`. A second copy is a
    // second thing to keep correct.
    const usage = TOPICS.usage.prompt
    expect(usage.match(/Latest 1\.2\.x\./g)?.length ?? 0).toBe(1)
  })
})

/**
 * The slice of a prompt between two anchors.
 *
 * Scoped rather than searched whole on purpose: both prompts mention
 * `facet update` in several places, so a document-wide `toContain` would
 * pass while the paragraph that actually tells an agent who owns
 * `facets.json` still named only two of the three commands — which is
 * exactly the state these tests were added to catch.
 */
function section(prompt: string, from: string, to: string): string {
  const start = prompt.indexOf(from)
  if (start === -1) expect.unreachable()
  const end = prompt.indexOf(to, start)
  if (end === -1) expect.unreachable()
  return prompt.slice(start, end)
}

describe('project-file ownership guidance', () => {
  // `facet update` rewrites a specifier only in latest mode; a plain
  // update moves the lockfile and leaves the manifest alone. The prompt
  // names the invocation rather than the command so an agent does not
  // conclude that any update edits the file.
  const MAINTAINERS = ['facet add', 'facet remove', 'facet update --latest']

  test('usage names every command that maintains facets.json, where it describes the file', () => {
    const block = section(TOPICS.usage.prompt, 'Your dependency list', 'facets.lock')
    for (const command of MAINTAINERS) expect(block).toContain(command)
  })

  test('overview names every command that maintains facets.json, where it describes the file', () => {
    const block = section(TOPICS.overview.prompt, 'A consuming project', 'facets.lock')
    for (const command of MAINTAINERS) expect(block).toContain(command)
  })
})

describe('manifest schema generation', () => {
  test('toJsonSchema with the predicate fallback does not throw and drops the predicate', () => {
    let schema: unknown
    expect(() => {
      schema = FacetManifestSchema.toJsonSchema({ fallback: { predicate: (ctx) => ctx.base } })
    }).not.toThrow()
    expect(JSON.stringify(schema)).not.toContain('predicate')
    const obj = schema as { required?: string[] }
    expect(obj.required).toContain('name')
    expect(obj.required).toContain('version')
  })
})

describe('instructionsCommand.run', () => {
  test('unknown topic returns exit code 1', async () => {
    const code = await instructionsCommand.run(['bogus'], {})
    expect(code).toBe(1)
  })

  test('known topic returns 0', async () => {
    const code = await instructionsCommand.run(['authoring'], {})
    expect(code).toBe(0)
  })

  test('no topic (default overview) returns 0', async () => {
    const code = await instructionsCommand.run([], {})
    expect(code).toBe(0)
  })
})
