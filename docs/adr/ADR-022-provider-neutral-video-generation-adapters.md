# ADR-022: Provider-neutral asynchronous video generation adapters

Status: Accepted

## Context

Creative Production plans are provider-neutral and immutable. Video vendors have different endpoints, task states, error payloads, model identifiers, and cost reporting. Embedding Pollo semantics in the plan or Dashboard would make upstream lineage vendor-dependent and complicate later Kling, Veo, Wan, or Runway support.

## Decision

Introduce a worker-only `VideoGenerationProvider` boundary with normalized submit, status, result, and error methods. Persist provider attempts separately from Creative Production plans. The Dashboard reads normalized database state only.

Pollo is the first adapter. It uses official header authentication, text-to-video, polling, 9:16, five/ten-second clips, and disabled native audio. Credentials and provider headers never cross the server/worker boundary.

Every explicit regeneration is an append-only attempt. Task IDs are persisted before polling so worker retries resume rather than resubmit. Cost values retain actual/estimated/unavailable provenance.

## Consequences

Upstream Creative Production remains immutable and provider-neutral. A new provider implements the same boundary and model policy without changing Campaign or plan data. The system stores external output URLs rather than downloading media in v1, so availability remains provider-dependent until a later asset-ingestion phase.
