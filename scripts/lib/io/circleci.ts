/**
 * CircleCI API v2 operations.
 *
 * Used by the release pipeline to explicitly trigger downstream workflows.
 * We trigger rather than relying on GitHub-to-CircleCI tag-push webhooks
 * because those webhooks have proven unreliable when the bot GitHub App
 * pushes tags — the CircleCI GitHub App installation appears to drop or
 * filter events originating from other bot actors. See
 * docs/contributing/release-pipeline.mdx for the full story.
 */

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const circleciIo = {
  /**
   * Trigger a pipeline run for a specific tag via CircleCI API v2.
   *
   * The target pipeline's internal workflow filters (tag regex in
   * release.yml) still apply, so calling this with `agent-facets@1.0.0`
   * fires only the `release-cli` workflow; calling with
   * `@agent-facets/core@1.0.0` fires only the `release` workflow. The
   * caller does not need to select which one.
   *
   * When `packageName` is provided, it is forwarded as the `package`
   * pipeline parameter. This is used by the `release` workflow's
   * `serial-group` key to queue package publishes per-package — so
   * releases of `@agent-facets/core` and `@agent-facets/adapter` can
   * run in parallel while repeat releases of the same package still
   * serialize. `release-cli` does not read this parameter.
   *
   * Requires the CIRCLECI_API_TOKEN env var (provisioned via the
   * `bot-context` CircleCI context).
   */
  triggerPipelineForTag: async (
    projectSlug: string,
    definitionId: string,
    tag: string,
    packageName?: string,
  ): Promise<{ id: string; number: number }> => {
    const token = process.env.CIRCLECI_API_TOKEN
    if (!token) {
      throw new Error(
        'CIRCLECI_API_TOKEN not set. Expected from the `bot-context` CircleCI context. ' +
          'See docs/contributing/release-pipeline.mdx for setup instructions.',
      )
    }

    // Fail fast on a malformed UUID rather than getting a cryptic 400 from
    // CircleCI ("Field 'definition_id' must be a valid uuid"). See the
    // constants.test.ts guardrail which also validates the real constant
    // at build time.
    if (!UUID_REGEX.test(definitionId)) {
      throw new Error(
        `Invalid pipeline definition ID: "${definitionId}" is not a valid UUID (expected 8-4-4-4-12 format). ` +
          'Check scripts/lib/constants.ts. Fetch the correct ID from CircleCI UI → Project Settings → Pipelines.',
      )
    }

    const body: {
      definition_id: string
      config: { tag: string }
      checkout: { tag: string }
      parameters?: { package: string }
    } = {
      definition_id: definitionId,
      config: { tag },
      checkout: { tag },
    }
    if (packageName) {
      body.parameters = { package: packageName }
    }

    const resp = await fetch(`https://circleci.com/api/v2/project/${projectSlug}/pipeline/run`, {
      method: 'POST',
      headers: {
        'Circle-Token': token,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      const errBody = await resp.text()
      throw new Error(`CircleCI pipeline trigger failed for tag ${tag}: ${resp.status} ${errBody}`)
    }

    return (await resp.json()) as { id: string; number: number }
  },
}
