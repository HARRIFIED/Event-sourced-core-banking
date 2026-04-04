# Spec 001: Event-Sourced Account Write Model And Initial Query Side

## Context

This project started as a modular monolith for learning and evolving a realistic event-sourced core banking backend. The initial focus was not on full distributed infrastructure yet. The goal was to establish the correct write model and a usable first read model before introducing more advanced messaging patterns.

At this stage, the important architectural goals were:

- make the account write side event sourced
- separate command handling from query handling
- introduce optimistic concurrency
- add snapshots so aggregate loads do not always replay from version `1`
- create initial read models for account details, balances, and statement history

## Problem

A plain CRUD account table would not fit the learning goal of this repository. We wanted:

- immutable history
- deterministic aggregate reconstruction
- auditability
- strong consistency on a single aggregate stream
- a query side optimized for reads rather than command validation

Without that split, the codebase would not demonstrate how event sourcing, CQRS, and later saga-based workflows should be structured.

## Solution Implemented

### 1. Event-Sourced Write Model

The write side was implemented around an `AccountAggregate` and an `AccountRepository`.

Key ideas:

- account commands load an aggregate from its event stream
- aggregate methods enforce business rules
- aggregate emits domain events rather than directly updating a row
- repository appends new events with optimistic concurrency checks

Representative flow:

1. controller receives command
2. command handler loads aggregate
3. aggregate is rehydrated from past events
4. aggregate executes business logic
5. repository appends uncommitted events

The append-only source of truth is the `events` table.

### 2. Optimistic Concurrency

The repository calculates `expectedVersion` when saving, and the event store compares it against the current stored stream version.

This prevents lost updates and stale writes.

### 3. Snapshot Support

Snapshots were added as a write-side performance optimization.

Instead of replaying a very long account stream from the beginning every time:

1. load latest snapshot
2. restore aggregate state
3. read events after snapshot version
4. replay only the remaining tail events

Snapshot policy in this repo:

- save a snapshot whenever the account crosses the next `100`-version boundary

Snapshots do not replace events. The event stream remains the source of truth.

### 4. Initial Query Side

The first read model was added for account-focused queries.

Tables:

- `account_summary`
- `account_statement`
- `projection_checkpoints`

Queries were added for:

- account details
- current balance
- account history

These queries read from projection tables, not from aggregate rehydration.

### 5. Initial Projection Runner

The original live projection approach was an in-process DB polling runner:

- read global events from the event store
- project them into read tables
- store a checkpoint
- continue from the last position after restart

This was intentionally simple and useful for learning, debugging, and rebuilds.

### 6. Lightweight SQL Migrations

Since the repo does not use an ORM, schema management was implemented with raw SQL migrations:

- shared `PG_POOL` from `pg`
- `schema_migrations` table
- startup migration runner in Postgres mode

This allowed schema evolution without introducing an ORM just for migrations.

## Result

At the end of this phase, the project had:

- an event-sourced account write model
- snapshot-aware aggregate loading
- a projection-backed account query side
- raw SQL migrations
- a replay-capable projection service

This established the baseline architecture for later outbox, Kafka, and transfer-saga work.
