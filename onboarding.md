# Developer Onboarding Guide

Welcome 👋 — this project is a **learning-oriented core-banking / digital-wallet scaffold** built with **NestJS**, **CQRS**, and **Event Sourcing** concepts.

This guide explains:

1. What each part of the codebase does.
2. How requests flow end-to-end.
3. How CQRS/Event Sourcing map to the actual files.
4. Why supporting resources (Postgres, Kafka, ZooKeeper) exist.

---

## 1) Big picture

This repository is a **modular monolith** (not microservices yet):

- Modules are split by business capabilities (`accounts`, `transfers`).
- Everything runs in one Nest application process for simplicity.
- Boundaries are still explicit so modules can be extracted later if needed.

Main entry:

- `src/main.ts` boots Nest, sets `/api` prefix, and global validation.
- `src/app.module.ts` wires all modules together.

---

## 2) Folder map and responsibilities

## Root files

- `package.json`: scripts + dependencies.
- `README.md`: quickstart and architecture summary.
- `.env.example`: required environment variables.
- `docker-compose.yml`: local infra (`postgres`, `zookeeper`, `kafka`, optional `app`).
- `Dockerfile`: container build for Nest app.
- `scripts/init.sql`: creates the `events` table (append-only event store schema).

## `src/` core structure

### `src/common/`

Shared building blocks:

- `domain/domain-event.ts` — event envelope shape (id, stream, metadata, payload).
- `domain/aggregate-root.ts` — aggregate base with:
  - `loadFromHistory(events)` for rehydration,
  - uncommitted event buffer,
  - `apply(...)` + `when(...)` pattern.
- `cqrs/command-context.ts` — command metadata (commandId/correlationId/etc.).

### `src/infrastructure/`

Adapters and technical concerns:

- `db/database.providers.ts`
  - Creates `PG_POOL` provider for Postgres connections.
- `event-store/event-store.interface.ts`
  - `EventStore` contract (`append`, `readStream`, `readAll`).
- `event-store/in-memory-event-store.ts`
  - In-memory event store implementation (great for quick local testing).
- `event-store/postgres-event-store.ts`
  - Production-like event store backed by Postgres.
  - Handles optimistic concurrency via expected version checks.
- `messaging/kafka.client.ts`
  - Kafka producer wrapper for publishing integration events.
- `projections/projection-runner.service.ts`
  - Replay skeleton that iterates through global event positions.
- `infrastructure.module.ts`
  - Chooses event store implementation based on `EVENT_STORE_KIND`.

### `src/modules/accounts/`

Write-side account logic:

- `application/commands/*` — command DTO-like classes for intent.
- `application/handlers/account-command.handlers.ts` — command handlers invoke domain aggregate and persist events.
- `application/dto/account-commands.dto.ts` — HTTP input validation rules.
- `application/events/account.events.ts` — event type constants.
- `domain/account.aggregate.ts` — business invariants and event application.
- `domain/account.repository.ts` — loads aggregate from stream + saves new events.
- `accounts.controller.ts` — HTTP endpoints dispatch commands via `CommandBus`.
- `accounts.module.ts` — module wiring and provider registration.

### `src/modules/transfers/`

Cross-account transfer orchestration starter:

- `application/commands/initiate-transfer.command.ts`
- `application/handlers/initiate-transfer.handler.ts`
  - issues withdraw then deposit commands.
- `application/sagas/transfer.saga.ts`
  - current placeholder for future durable saga orchestration.
- `transfers.controller.ts` — transfer API endpoint.
- `transfers.module.ts` — module wiring.

---

## 3) CQRS in this codebase

CQRS = **Command Query Responsibility Segregation**.

In this project right now:

- **Command side exists** (create/deposit/withdraw/freeze/transfer initiation).
- **Query side is minimal** (health endpoint only; projections runner scaffold is present).

How it maps to files:

- Controllers receive HTTP commands (`accounts.controller.ts`, `transfers.controller.ts`).
- Controllers dispatch commands to `@nestjs/cqrs` `CommandBus`.
- Command handlers (`application/handlers/*`) execute business use-cases.
- Handlers interact with aggregates through repositories.

Future query side:

- Build projection tables/materialized views.
- Serve read APIs from projections, not from write aggregates.

---

## 4) Event Sourcing in this codebase

Event Sourcing = persist **facts/events**, not current state rows.

Current implementation flow:

1. Handler loads event stream for aggregate (`AccountRepository.getById`).
2. Aggregate rehydrates by replaying events (`loadFromHistory`).
3. Command invokes aggregate method (`create`, `deposit`, etc.).
4. Aggregate emits new domain events into uncommitted buffer.
5. Repository saves uncommitted events using `EventStore.append(...)` with `expectedVersion`.

Why this matters:

- Full audit trail from immutable event history.
- State can be rebuilt at any time by replaying stream events.
- Concurrency conflicts are explicit and detectable.

---

## 5) Optimistic concurrency and stream safety

Where it happens:

- `AccountRepository.save(...)` computes expected version from aggregate state.
- `PostgresEventStore.append(...)` compares DB current version to expected version.
- If mismatch => throws `WrongExpectedVersion` style error.

Additional safety:

- DB schema has unique `(stream_id, stream_version)` in `scripts/init.sql`.
- App uses advisory transaction lock per stream in Postgres append path to serialize same-stream writers.

---

## 6) Kafka and ZooKeeper: why they are here

## Kafka usage in this project

Current status:

- `KafkaClient` exists as producer abstraction.
- It is foundation for publishing events to topics (for projections, integrations, downstream consumers).

How you can evolve it:

- Publish domain/integration events after successful append.
- Introduce outbox pattern for reliability.
- Add consumers for projection workers/read models.

## Why ZooKeeper appears in `docker-compose.yml`

Your compose uses Confluent Kafka image version that depends on ZooKeeper in this setup.

- ZooKeeper coordinates broker metadata/cluster state for that deployment model.
- Newer Kafka deployments can run in KRaft mode without ZooKeeper, but this scaffold currently uses the ZooKeeper-based config for simplicity and compatibility with the selected image.

---

## 7) Request flow example: Create Account

Endpoint: `POST /api/accounts`

Flow:

1. `AccountsController.createAccount(...)` validates input DTO and dispatches `CreateAccountCommand`.
2. `CreateAccountHandler` loads account aggregate via repository.
3. Aggregate method `create(...)` enforces rules and emits `AccountCreated` event.
4. Repository persists event via chosen event store (in-memory or Postgres).
5. Response returns accepted status.

The same pattern applies to deposit/withdraw/freeze.

---

## 8) Local run mental model

When running with Postgres event store:

1. Start infra with Docker Compose (`postgres`, `zookeeper`, `kafka`).
2. Ensure `events` table exists (`scripts/init.sql`).
3. Run app with `EVENT_STORE_KIND=postgres`.
4. API writes become event stream inserts in Postgres.
5. Kafka client is available for future event publication.

For quick experiments:

- set `EVENT_STORE_KIND=in-memory` and run without Postgres.

---

## 9) Suggested next learning steps

1. Add explicit query projections (`account_summary`, `account_statement`).
2. Persist projection checkpoints and replay from positions.
3. Add idempotency table keyed by `commandId`.
4. Make transfer saga durable (state store, retries, compensation paths).
5. Add outbox + Kafka publishing for reliable event delivery.
6. Add integration tests for concurrent updates and version conflicts.

---

## 10) Quick glossary

- **Aggregate**: consistency boundary (here, Account).
- **Command**: intent to change state.
- **Event**: immutable fact that happened.
- **Projection**: read model built by consuming events.
- **Saga/Process Manager**: orchestrates multi-step workflows across aggregates.
- **Stream**: ordered events for one aggregate instance (`account-{id}`).
- **Expected version**: optimistic concurrency token for append safety.

If you want, next I can create a second guide called `walkthrough-first-hour.md` with a hands-on sequence (run app, create accounts, deposit, transfer, inspect DB events table) so you can learn by executing the flow end-to-end.
