# ADR-025: Multi-product Shorts use verified cards and local deterministic composition

## Status

Accepted — 2026-10-13

## Decision

The first multi-product creative archetype is `three_picks_v1`. It uses exactly three human-selected curated products and real immutable Product Asset revisions. Product selection order is presentation order, never a rank. Product facts remain human-verified evidence; AI generates only copy and scene ordering.

Final video rendering is provider-neutral at the domain boundary and locally implemented behind `FinalCompositionProvider`. The database stores a canonical render manifest and fingerprints, not FFmpeg commands. Background animation is deterministic and product-subordinate. Pollo, Wan, and I2V remain optional tools outside this path.

Campaign Iterations use an XOR between the existing single-product reference and a new Product Set reference, preserving all existing single-product rows and Publication/Analytics lineage.

## Consequences

Three-product Shorts can be reproduced without external video-generation cost. Every visible product and fact is traceable to immutable evidence. The first renderer is Windows-compatible FFmpeg, but another renderer can replace it without changing Campaign or plan data. Audio and richer background providers can be added later without changing the v1 archetype snapshot.
