## ADDED Requirements

### Requirement: Adapters reject metadata they cannot represent on disk

An adapter SHALL reject per-asset metadata that its tool's storage format cannot
faithfully represent. When `buildAssetMetadata` receives a value whose shape is
incompatible with the adapter's on-disk encoding, the adapter SHALL return a
validation failure rather than silently producing a file the tool cannot read.
The failure SHALL identify the offending field so the facet author can correct
the manifest.

This protects facet authors from a subtle class of corruption: metadata that
validates structurally but, once serialized into the tool's file format, yields
an asset the tool refuses to load. An adapter whose front-matter encoding admits
only single-line scalar values, for example, SHALL reject nested objects and
arrays instead of emitting multi-line front-matter its tool cannot parse.

#### Scenario: Metadata incompatible with the tool's format is rejected

- **WHEN** an adapter builds metadata containing a value its tool's on-disk
  format cannot represent
- **THEN** the result SHALL indicate failure
- **AND** the result SHALL include an error identifying the offending field

#### Scenario: Metadata compatible with the tool's format is accepted

- **WHEN** an adapter builds metadata whose values its tool's on-disk format can
  represent
- **THEN** the result SHALL indicate success
- **AND** the result SHALL include the enriched metadata
