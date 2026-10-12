# ADR-024: Image-to-video uses immutable asset revisions

## Status

Accepted — 2026-10-12

## Decision

Image-to-video attempts reference an immutable `product_asset_revisions` row and content SHA-256, not a mutable Product Asset URL. Provider-neutral requests are checked against versioned model capability manifests before a provider adapter maps them to an external payload.

Private object storage is accessed through `ProductAssetBlobStore`. Only a short-lived signed URL crosses the provider boundary, immediately before submit. Permission and I2V approval are frozen per revision and copied into each generation attempt.

## Consequences

External source changes cannot silently change historical generation input. Derived padding is traceable to a parent revision. Duplicate billing is prevented by an asset-aware fingerprint and by treating uncertain submit outcomes as blocked evidence rather than retryable failures. Cloud storage and future I2V providers can replace adapters without changing Campaign or Creative Production lineage.
