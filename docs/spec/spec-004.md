# Spec 004: Durable Internal Transfers

## Context

The repo already had event-sourced accounts, optimistic concurrency hardening, snapshots, an outbox, Kafka-backed live projections, API idempotency, and business transaction deduplication.

What it did not have was a production-shaped transfer workflow. The original `transfers` module was scaffolding only: a request could chain a withdrawal and a deposit, but there was no durable transfer stream, no restart-safe lifecycle state, no compensation after partial failure, and no transfer status read model for clients.

That gap mattered because transfers span multiple money movements and cannot safely rely on a naive synchronous handler if the system is expected to survive crashes, retries, and partial failures without double-moving funds.

## Goals

This phase implemented a production-shaped v1 transfer capability with these goals:

- internal account-to-account transfers only
- same-currency only
- durable transfer intent and lifecycle
- async processing with client status lookup
- immediate debit plus compensation if destination credit fails
- restart-safe retry behavior
- query-side visibility into transfer progress and outcome

This remains a learning project, so the implementation stays readable and intentionally avoids broader payment-rail concerns such as external settlement, FX, and compliance workflows.

## Design Chosen

### 1. Transfers Became First-Class Event Streams

Each transfer now has its own stream:

```text
transfer-{transferId}
```

The write-side source of truth is a `TransferAggregate`.

Core transfer states:

- `INITIATED`
- `DEBIT_IN_PROGRESS`
- `DEBITED`
- `CREDIT_IN_PROGRESS`
- `COMPLETED`
- `FAILED`
- `COMPENSATION_IN_PROGRESS`
- `COMPENSATED`

Key transfer events:

- `TransferInitiated`
- `TransferDebitStarted`
- `TransferDebited`
- `TransferCreditStarted`
- `TransferCompleted`
- `TransferFailed`
- `TransferCompensationStarted`
- `TransferCompensated`

This keeps the workflow auditable and reconstructible from the event log after a restart.

### 2. API Contract Shifted To Async Acceptance

`POST /api/transfers` now:

- requires `Idempotency-Key`
- requires a client-supplied `transferId`
- persists the transfer intent first
- returns `202 Accepted` semantics rather than pretending synchronous completion

Clients are expected to call:

```text
GET /api/transfers/:transferId
```

to observe progression to `COMPLETED`, `FAILED`, or `COMPENSATED`.

### 3. A Durable Coordinator Drives The Workflow

The transfer coordinator now advances pending transfers through their lifecycle.

High-level flow:

1. `TransferInitiated` is persisted.
2. Coordinator records `TransferDebitStarted`.
3. Source account withdrawal runs.
4. On success, `TransferDebited` is persisted.
5. Coordinator records `TransferCreditStarted`.
6. Destination deposit runs.
7. On success, `TransferCompleted` is persisted.

If debit fails before money leaves the source account, the transfer becomes `FAILED`.

If debit succeeds but credit fails terminally, the coordinator records `TransferFailed`, starts compensation, deposits the money back into the source account, and ends `COMPENSATED`.

### 4. Transfer Legs Needed Retry-Safe Transaction Semantics

The existing transaction registry worked well for one-shot API requests, but a durable async transfer needed more:

- the same logical debit, credit, or compensation leg may be retried after a crash
- a retry must not double-apply money movement
- a transient infrastructure failure must not permanently poison the logical leg

To support that, transfer leg transaction ids are now derived from `transferId`, for example:

- `{transferId}:debit`
- `{transferId}:credit`
- `{transferId}:compensation`

The transaction registry was extended to distinguish:

- `FAILED_RETRYABLE`
- `FAILED_TERMINAL`

This allows the coordinator to safely reopen a retryable leg without minting a new transaction id and risking duplicate money movement.

### 5. Transfer Query Model Was Added

A new `transfer_summary` projection now stores:

- transfer identity
- source and destination accounts
- amount and currency
- current status
- failure reason and stage
- debit, credit, and compensation transaction ids
- attempt counters
- created and updated timestamps

This projection is updated:

- through Kafka consumers in Postgres mode
- through the in-memory projection replay loop in local and test mode

## Important Safeguards

### Domain Guards

Transfer initiation rejects:

- same source and destination account
- non-positive amount
- missing source or destination account
- transfer currency mismatch with either account

### Recovery Behavior

Pending transfers are not lost on restart because the lifecycle is stored on the transfer stream.

If the process dies after a leg starts but before the transfer stream is advanced to the next state, the coordinator can retry the same leg using the same transaction id and let the transaction registry absorb duplicates safely.

### Projection And Rebuild Support

Transfer projections are rebuildable from the event store through:

- HTTP admin endpoint: `POST /api/admin/projections/transfers/:transferId/rebuild`
- CLI: `npm run projections:rebuild -- transfer <transferId>`

This matches the account-side rebuild model and keeps the new read model operationally teachable.

## Tradeoffs And Non-Goals

### Why Immediate Debit Plus Compensation?

For this project phase, immediate debit plus compensation was chosen over funds reservation.

Why:

- simpler to teach with the current account model
- fits the existing deposit and withdraw primitives
- still demonstrates real-world saga concerns

What it does not solve:

- customer-visible balance holds
- pending funds states
- authorization and capture patterns

### Why Internal Transfers Only?

External rails would add:

- provider and network acknowledgement states
- inbound settlement handling
- reconciliation jobs
- manual repair workflows

That would dilute the learning focus of this phase. Internal transfers are enough to introduce durable orchestration, compensation, async APIs, and query-side visibility.

## Code Areas Added Or Changed

Key additions in this phase:

- `src/modules/transfers/domain/transfer.aggregate.ts`
- `src/modules/transfers/domain/transfer.repository.ts`
- `src/modules/transfers/application/services/transfer-coordinator.service.ts`
- `src/modules/transfers/query/*`
- `src/infrastructure/projections/transfer-events-consumer.service.ts`
- transfer read-model wiring in `InfrastructureModule`
- transfer projection rebuild support in `ProjectionRunnerService`
- migration for `transfer_summary`

The transaction registry was also extended so transfer legs can be retried safely without double-applying money movement.

## Tests Added

This phase added coverage for:

- transfer aggregate guards and state ordering
- happy-path debit then credit completion
- insufficient-funds failure before debit completes
- compensation after a debited transfer fails during credit
- transfer API acceptance and status lookup

## Result

Transfers are no longer scaffolding.

The repo now has a realistic, event-sourced, async internal transfer workflow with:

- durable lifecycle state
- restart-safe orchestration
- leg-level retry safety
- compensation for partial failure
- transfer status query support
- rebuildable transfer projections

That makes the project meaningfully closer to a production-shaped core banking learning system while still keeping the architecture understandable.
