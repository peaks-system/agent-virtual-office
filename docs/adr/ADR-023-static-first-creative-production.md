# ADR-023: Static-first Creative Production Plan v2

Status: Accepted

## Context

Full video generation is a poor default for product introductions because it can alter product shape, color, labels, controls, and perceived dimensions. Revenue Lab already stores authorized Product Assets as the factual visual source and keeps Creative Production revisions immutable.

## Decision

Create a versioned v2 planning contract instead of modifying v1. The planner chooses from five provider-neutral rendering strategies and prefers static Product Assets. Accurate product display begins with a static scene. Image motion requires owned or explicitly I2V-authorized media. Stylized and realistic generation are reserved for scenes that do not require accurate product depiction.

Model recommendations are abstract capability classes, not vendor or model names. The current Pollo adapter, worker, RPC, and database schema remain unchanged. Consequently, `image_motion_scene` is planned and exported but is not submitted through the existing text-to-video control.

## Consequences

Product identity remains anchored to human-recorded assets, while generation remains available for supporting atmosphere. Final composition can implement static motion later without provider cost. A future I2V adapter can consume the v2 export after independently enforcing asset permissions, without changing stored plans or v1 data.
