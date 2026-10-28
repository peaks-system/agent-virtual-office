---
status: accepted
date: 2026-10-10
---

# ADR-016: Keep YouTube Analytics credentials local and performance lineage in Supabase

## Context

Phase 3B needs offline YouTube Analytics access on one Windows PC. Supabase and the browser are inappropriate token stores, while future cloud execution must not be coupled to a Windows-only implementation. Performance facts must remain attributable to the exact Publication and immutable Campaign Iteration treatment.

## Decision

Define `YouTubeAnalyticsCredentialStore` as the secret boundary. The first implementation encrypts credential JSON with Windows CurrentUser DPAPI and writes only ciphertext to an atomic repository-external file under Local App Data. It is replaceable by a cloud secret implementation without changing OAuth, API, database, or Dashboard contracts.

The server owns an ephemeral OAuth transaction: random state, S256 PKCE verifier/challenge, dynamic `127.0.0.1` listener, system-browser launch, code exchange, owned-channel verification, credential save, and non-secret connection upsert. The browser-facing API returns only safe flow state.

Manual performance collection first verifies the publication video through YouTube Data API and rejects a channel mismatch. Analytics results are immutable snapshots linked to Publication, Iteration, Campaign, connection, and run. Missing report values are null; an empty report is explicit `no_data` rather than fabricated zero performance.

## Consequences

- Local secrets remain unavailable to browser code and Supabase administrators.
- Losing the DPAPI user profile requires reauthorization; DB metadata alone cannot recover access.
- Cloud migration supplies another credential-store implementation and OAuth callback host while preserving the service contract.
- Reporting/retention/scheduling can be added additively without changing `youtube-analytics-v1` records.

## Applies To

Phase 3B credential storage, OAuth flow, Google API client, connection metadata, Analytics runs/snapshots, Revenue API, and Campaign Board UI.
