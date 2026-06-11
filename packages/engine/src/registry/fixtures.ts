/**
 * Wire-typed registry fixture builders.
 *
 * Each builder returns a plain object typed against the canonical wire
 * schema (via the `Wire*` aliases in `./wire.ts`). Sensible defaults
 * for every required field; callers override only the fields that matter
 * to their test. If a registry schema rename lands (e.g., another
 * camelCase→snake_case sweep), only this file needs updating — every
 * consumer gets the fix for free.
 *
 * These are pure-data factories with NO test-framework dependency.
 * Tests wrap them in `JSON.stringify` / `new Response(...)` themselves.
 */

import type {
  WireAssetCounts,
  WireErrorResponse,
  WireMetadataResponse,
  WirePackageListItem,
  WirePackageListResponse,
  WirePublishResponse,
  WireQueuedForReviewBody,
} from './wire.ts'

// ---------------------------------------------------------------------------
// VersionMetadata — GET /v0/facets/{name}/{version}
// ---------------------------------------------------------------------------

export function versionMetadata(overrides?: Partial<WireMetadataResponse>): WireMetadataResponse {
  return {
    name: 'cowsay',
    version: '0.1.0',
    content_hash: 'sha256:abc',
    content_integrity: 'sha256:def',
    manifest_json: '{}',
    published_at: '2026-05-01T00:00:00Z',
    publisher: 'test-publisher',
    size_bytes: 100,
    asset_counts: { agents: 0, commands: 1, servers: 0, skills: 0 },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// FacetSummary — items inside GET /v0/facets (search)
// ---------------------------------------------------------------------------

export function facetSummary(overrides?: Partial<WirePackageListItem>): WirePackageListItem {
  return {
    name: 'cowsay',
    latest_version: '0.1.0',
    published_at: '2026-05-01T00:00:00Z',
    publisher: 'test-publisher',
    asset_counts: { agents: 0, commands: 0, servers: 0, skills: 0 },
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// SearchResponse — GET /v0/facets
// ---------------------------------------------------------------------------

export function searchResponse(facets: WirePackageListItem[]): WirePackageListResponse {
  return { facets }
}

// ---------------------------------------------------------------------------
// ApiErrorBody — every 4xx/5xx envelope
// ---------------------------------------------------------------------------

export function apiError(overrides?: Partial<WireErrorResponse>): WireErrorResponse {
  return {
    code: 'E_FACET_NOT_FOUND',
    docs_url: 'https://agentfacets.io/errors/E_FACET_NOT_FOUND',
    error: 'facet not found',
    fix: "run 'facet search' to find available facets",
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// PublishResponse — POST /v0/facets/{name}/versions (201)
// ---------------------------------------------------------------------------

export function publishResponse(overrides?: Partial<WirePublishResponse>): WirePublishResponse {
  return {
    content_hash: 'sha256:placeholder',
    name: 'cowsay',
    version: '0.1.0',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// QueuedForReviewBody — POST /v0/facets/{name}/versions (202)
// ---------------------------------------------------------------------------

export function queuedForReview(overrides?: Partial<WireQueuedForReviewBody>): WireQueuedForReviewBody {
  return {
    status: 'QUEUED_FOR_REVIEW',
    reason: 'reserved',
    fix: 'an admin will review your submission shortly',
    docs_url: 'https://agentfacets.io/queue',
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// AssetCounts — reusable sub-object
// ---------------------------------------------------------------------------

export function assetCounts(overrides?: Partial<WireAssetCounts>): WireAssetCounts {
  return {
    agents: 0,
    commands: 0,
    servers: 0,
    skills: 0,
    ...overrides,
  }
}
