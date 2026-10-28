# ADR-019: Draft mutation and evidence-locked Campaign lifecycle

## Status

Accepted for Campaign lifecycle operations v1.

## Decision

Creative treatment is mutable only while an Iteration is `draft` and has no Publication. Publication registration permanently closes that mutation path; later creative changes are represented by a new Iteration with copied product/analysis lineage.

Hard deletion is a database-authorized exception for evidence-free draft-only Campaigns. Once a Publication, Analytics record, or generic evidence marker exists, deletion is denied and the operator may only void the Campaign with a recorded reason. Voiding is reversible only through a future explicitly designed operation; v1 preserves it as historical lineage and hides it from the primary ledger.

## Rationale

The Campaign Iteration is the experiment unit. Rewriting a treatment after publication would attach later text to earlier performance, making learned results unreliable. A narrow draft mutation path reduces pre-publication friction while database checks prevent the UI or API from bypassing evidence preservation.

## Consequences

Draft revision history is not retained in v1. IDs and lineage remain stable during a draft edit, while published variants receive distinct Iteration IDs and treatment fingerprints. Future affiliate ingestion must create a Campaign evidence marker so its Campaign cannot be hard-deleted.
