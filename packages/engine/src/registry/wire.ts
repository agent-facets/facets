/**
 * Curated wire-format types for the registry HTTP API.
 *
 * Re-exports a stable set of named types from the generated module so
 * call sites do not depend on `openapi-typescript`'s internal output
 * structure. If the registry renames a schema or restructures a
 * response, the breakage surfaces here — in one file, against a
 * stable set of public names.
 *
 * For the deeper `paths` / `operations` / `components` shape, see
 * `./generated/registry-api.ts`. Direct imports from `generated/`
 * outside this file are forbidden by convention (see
 * `packages/engine/AGENTS.md`).
 */

import type { components } from './generated/registry-api.ts'

/**
 * Wire shape returned by `GET /v0/packages/{name}/{version}` (the
 * version-metadata endpoint). Carries the canonical published metadata
 * for one resolved facet version.
 */
export type WireMetadataResponse = components['schemas']['VersionMetadata']

/**
 * Wire shape returned by `GET /v0/packages` (search/listing). Top
 * level is `{ facets: WirePackageListItem[] }`.
 */
export type WirePackageListResponse = components['schemas']['SearchResponse']

/**
 * Single facet entry inside `WirePackageListResponse.facets`. Includes
 * `name`, `latestVersion`, `publishedAt`, `assetCounts`, plus optional
 * `author` / `description`.
 */
export type WirePackageListItem = components['schemas']['FacetSummary']

/**
 * Wire shape returned by `GET /v0/packages/{name}` (npm-style info:
 * latest version + version list).
 */
export type WirePackageInfoResponse = components['schemas']['InfoResponse']

/**
 * Wire shape of the registry's flat error envelope, returned on every
 * 4xx/5xx. Shape: `{ code, docsUrl, error }` where `error` is the
 * human message and `code` is one of the canonical error codes.
 */
export type WireErrorResponse = components['schemas']['ApiErrorBody']

/**
 * Canonical registry error codes, derived from the wire envelope's
 * `code` field. Useful as the input type for switch-exhaustiveness
 * checks; replaces the previously hand-coded `RegistryErrorCode`
 * union and inherits any additions automatically when the snapshot
 * is regenerated.
 */
export type WireErrorCode = WireErrorResponse['code']

/**
 * Wire shape of the publish endpoint's success response (HTTP 201).
 * Carries the published `name`, `version`, and `contentHash`.
 */
export type WirePublishResponse = components['schemas']['PublishResponse']

/**
 * Wire shape of the publish endpoint's queued-for-review response
 * (HTTP 202). Returned when a first-time publish of a reserved or
 * over-budget global facet is accepted into the registry's moderation
 * queue rather than published immediately. Carries `status:
 * 'QUEUED_FOR_REVIEW'` (the success discriminant), a `reason`, and the
 * `fix` / `docsUrl` guidance text the CLI renders verbatim.
 */
export type WireQueuedForReviewBody = components['schemas']['QueuedForReviewBody']

/**
 * Wire shape of the health endpoint's success response.
 */
export type WireHealthResponse = components['schemas']['HealthResponse']

/**
 * Wire shape returned by `GET /v0/auth/me` (the authenticated-profile
 * endpoint). Carries `username`, `email`, `tier`, `suspended`, and
 * `user_uuid`. Used to verify a pasted token at login time and to back
 * the `facet whoami` readout.
 */
export type WireAuthMeResponse = components['schemas']['AuthMeResponse']

/**
 * Asset counts attached to every search result and metadata response.
 * One required number per asset kind: `agents`, `commands`, `servers`,
 * `skills`. Used by `facet search` to render a per-result summary
 * (D10 in the design).
 */
export type WireAssetCounts = components['schemas']['AssetCounts']
