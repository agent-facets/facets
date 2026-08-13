import { join } from 'node:path'
import type { Adapter, AssetCapability, AssetRequestContext, McpServerCapability } from '@agent-facets/adapter'
import {
  ADAPTER_API_VERSION,
  planSingleFileInstall,
  planSingleFileRemoval,
  planSkillBundleInstall,
  planSkillBundleRemoval,
} from '@agent-facets/adapter'

/**
 * A realistic `0.3` adapter for engine tests.
 *
 * It composes the published SDK planners rather than hand-rolling plans, so
 * these tests exercise the same containment rules, front-matter assembly, and
 * no-op elimination a real adapter gets — and cannot pass because a fixture
 * was more permissive than the SDK.
 *
 * Layout mirrors the first-party adapters: `<projectRoot>/.<name>/` with
 * `skills/<name>/SKILL.md`, `agents/<name>.md`, and `commands/<name>.md`.
 */
export interface TestAdapterOptions {
  /** Record every planned install, for tests that assert on metadata. */
  readonly onPlanInstall?: (request: { name: string; metadata: unknown }) => void
  /** Fail every plan with this cause, for failure-path tests. */
  readonly failPlanning?: 'install' | 'removal'
  readonly mcpServers?: false | McpServerCapability
  /** Declare no asset capability at all. */
  readonly assets?: false
}

function baseDirFor(context: AssetRequestContext, name: string): string | null {
  if (context.scope === 'system') return null
  return join(context.projectRoot, `.${name}`)
}

export function createTestAdapter(name: string, options: TestAdapterOptions = {}): Adapter {
  const assets: AssetCapability = {
    async planInstall(request) {
      options.onPlanInstall?.({ name: request.name, metadata: request.metadata })
      if (options.failPlanning === 'install') {
        return { ok: false, failure: { code: 'io-failed', path: request.name, message: 'planning refused' } }
      }
      const baseDir = baseDirFor(request, name)
      if (baseDir === null) return { ok: false, failure: { code: 'unsupported-scope', scope: request.scope } }
      const metadata = request.metadata as Record<string, unknown>
      if (request.assetType === 'skill') {
        const root = join(baseDir, 'skills', request.name)
        return planSkillBundleInstall(
          { root, primaryFile: join(root, 'SKILL.md'), boundary: baseDir },
          {
            content: request.content,
            metadata,
            companions: request.companions,
            ownedCompanionPaths: request.ownedCompanionPaths,
          },
        )
      }
      return planSingleFileInstall(
        { file: join(baseDir, `${request.assetType}s`, `${request.name}.md`), boundary: baseDir },
        request.content,
        metadata,
      )
    },

    async planRemoval(request) {
      if (options.failPlanning === 'removal') {
        return { ok: false, failure: { code: 'io-failed', path: request.name, message: 'planning refused' } }
      }
      const baseDir = baseDirFor(request, name)
      if (baseDir === null) return { ok: false, failure: { code: 'unsupported-scope', scope: request.scope } }
      if (request.assetType === 'skill') {
        const root = join(baseDir, 'skills', request.name)
        return planSkillBundleRemoval(
          { root, primaryFile: join(root, 'SKILL.md'), boundary: baseDir },
          request.ownedCompanionPaths,
        )
      }
      return planSingleFileRemoval({
        file: join(baseDir, `${request.assetType}s`, `${request.name}.md`),
        boundary: baseDir,
      })
    },
  }

  return {
    name,
    apiVersion: ADAPTER_API_VERSION,
    assets: options.assets === false ? false : assets,
    mcpServers: options.mcpServers ?? false,
    buildAssetMetadata: (data) => ({ ok: true, data: (data ?? {}) as Record<string, unknown> }),
  }
}

/** Where {@link createTestAdapter} puts a single-file asset. */
export function testAdapterAssetPath(
  projectRoot: string,
  adapterName: string,
  assetType: 'agent' | 'command',
  name: string,
): string {
  return join(projectRoot, `.${adapterName}`, `${assetType}s`, `${name}.md`)
}

/** Where {@link createTestAdapter} puts a skill's primary file. */
export function testAdapterSkillPath(projectRoot: string, adapterName: string, name: string): string {
  return join(projectRoot, `.${adapterName}`, 'skills', name, 'SKILL.md')
}
