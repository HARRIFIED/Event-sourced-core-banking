# Spec 002: Outbox, Kafka Live Projections, And Projection Repair

## Context

After the initial read side was in place, the project still had an important architectural gap: live projection updates depended on local DB polling. That was useful for replay and learning, but it was not the desired long-term live update path.

At the same time, I wanted a more production-shaped event delivery pipeline that could support:

- reliable event publication
- decoupled live projection updates
- future distributed consumers
- safer projection recovery when consumers miss events

## Problems

### 1. Event Publication Was Not Reliable Enough

Before this update, there was no durable handoff between:

- the write-side event append
- and asynchronous downstream processing

That creates a classic risk:

- event is saved, but never published
- or publication logic is tightly coupled to write success

### 2. Live Projection Delivery Was DB-Polling Based

The initial projection runner read directly from the event store and updated read tables in process.

That is fine for:

- replay
- rebuild
- learning

But it is not the best live delivery mechanism once asynchronous infrastructure like Kafka is available.

### 3. Projections Could Drift From The Source Of Truth

A real failure scenario occurred:

- Kafka consumer was down
- new events were persisted to the event store
- projection state missed at least two stream version
- a later event was projected before the missing two
- `account_summary` and `account_statement` became inconsistent with the event store

The source of truth was still correct, but the read model was not.

## Solution Implemented

### 1. Transactional Outbox

An outbox was added so that event persistence and publish intent are recorded together.

New pieces:

- `outbox_events` table
- `OutboxStore` abstraction
- in-memory and Postgres outbox implementations

Write-side flow now becomes:

1. append event to `events`
2. insert matching outbox row in the same transaction
3. commit both together

This guarantees that if the event exists in the event store, the publish work also exists durably in the outbox.

### 2. Background Outbox Publisher

A background publisher service was added to:

- claim pending outbox rows
- publish them to Kafka
- mark them as published or failed

The outbox was hardened with:

- `processing_started_at`
- explicit claiming
- `FOR UPDATE SKIP LOCKED`

This makes it safer for multiple publisher instances and prevents competing publishers from working the same outbox rows at the same time.

### 3. Kafka-Driven Live Projections

Live account projections were moved from DB polling to Kafka.

New live flow:

1. write side appends event
2. same transaction stages outbox row
3. outbox publisher working in background sends event to Kafka topic `account-events`
4. Kafka consumer receives event
5. `AccountProjector` updates `account_summary` and `account_statement`

This decouples live read-model updates from direct event-store polling.

### 4. Projection Runner Repositioned As Manual Replay Tool

`ProjectionRunnerService` was intentionally kept, but its role changed.

It is no longer the live updater.
It is now the manual DB-polling fallback and rebuild utility.

That preserves the ability to:

- rebuild from the event store
- repair read models after incidents
- backfill from source of truth

### 5. Strict Projection Gap Detection

The projector was hardened to enforce sequential stream versions.

New rule:

- if current projected version is `5`, the next event must be version `6`
- duplicates can be skipped
- gaps are not silently accepted

If a later version arrives before the missing one, the projector now throws a `ProjectionGapError`.

This is important because silently projecting version `7` while version `6` is missing can permanently corrupt read-side balances and statements with no warning or alerts.

### 6. Repair And Rebuild Tooling

Projection rebuild support was added for both:

- a single account
- the full read model (all accounts in the system)

Rebuild entry points:

- HTTP admin endpoints
- CLI script

This allows operators or developers to restore read models from the event store when projections drift.

### 7. DB-Level Safety For Statement Ordering

To strengthen projection correctness, a unique constraint was added for:

- `(account_id, stream_version)` in `account_statement`

This helps ensure the statement cannot contain duplicate versions for the same account stream.

## Result

At the end of this phase, the project now has:

- transactional outbox persistence
- background Kafka publication
- Kafka-driven live account projections
- manual replay/rebuild fallback from the event store
- strict gap detection in projections
- repair endpoints and CLI rebuild tooling

This makes the read side much more resilient and brings the project closer to a production-shaped asynchronous architecture, while still preserving direct replay from the event store when needed.
