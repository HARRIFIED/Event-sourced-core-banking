# Event-Sourced Core Banking (NestJS Foundation)

This repository now contains a **senior-level scaffold** for an event-sourced, CQRS-based core banking / digital wallet system.

## Architecture decision: Modular Monolith first

For a learning project and early product stage, this scaffold uses a **modular monolith** with clear boundaries:

- `accounts` module (aggregate + commands)
- `transfers` module (orchestration/saga entry point)
- `infrastructure` module (event store, projections, messaging)

Why this over microservices initially:

- keeps complexity focused on event sourcing/CQRS fundamentals,
- avoids distributed operational overhead too early,
- enables later extraction of modules into services once boundaries stabilize.

## What is included

- NestJS app with CQRS wiring
- Domain-driven aggregate base and event contracts
- Account aggregate with core invariants
- Command handlers for account create/deposit/withdraw/freeze
- Transfer command handler skeleton for cross-account orchestration
- Event store abstraction with:
  - in-memory implementation (fast local learning)
  - PostgreSQL implementation (append-only stream + optimistic concurrency)
- Projection replay runner skeleton
- Kafka producer client skeleton for event integration
- Docker and Docker Compose for app + PostgreSQL + Kafka

## Project structure

```text
src/
  common/
    cqrs/
    domain/
  infrastructure/
    db/
    event-store/
    messaging/
    projections/
  modules/
    accounts/
    transfers/
```

## Quickstart

### 1) Start dependencies

```bash
docker compose up -d postgres zookeeper kafka
```

### 2) Install dependencies

```bash
npm install
```

### 3) Run DB schema bootstrap

```bash
docker compose exec -T postgres psql -U banking -d banking -f /docker-entrypoint-initdb.d/init.sql
```

### 4) Run app locally

```bash
npm run start:dev
```

Health endpoint:

- `GET http://localhost:3000/api/health`

## Example API commands

Create account:

```bash
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d '{"accountId":"acc-1","ownerId":"user-1","currency":"USD"}'
```

Deposit:

```bash
curl -X POST http://localhost:3000/api/accounts/acc-1/deposits \
  -H "Content-Type: application/json" \
  -d '{"amount":1000,"currency":"USD","transactionId":"txn-1"}'
```

Transfer:

```bash
curl -X POST http://localhost:3000/api/transfers \
  -H "Content-Type: application/json" \
  -d '{"sourceAccountId":"acc-1","destinationAccountId":"acc-2","amount":150,"currency":"USD"}'
```

## Environment variables

Key variables used by the scaffold:

- `PORT` (default `3000`)
- `EVENT_STORE_KIND` (`in-memory` or `postgres`)
- `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`
- `KAFKA_BROKER`, `KAFKA_CLIENT_ID`

See `.env.example`.

## Next engineering steps

1. Add idempotency store keyed by command ID.
2. Add snapshot store and snapshot-aware account repository.
3. Replace transfer handler with full durable saga state machine + retries/timeouts.
4. Build read projections (account summary, statement, transfer status).
5. Add outbox pattern and Kafka consumers for projection workers.
6. Add integration and concurrency tests for expected-version conflicts.
# Event-Sourced Core Banking / Digital Wallet

A learning project for building a **realistic core banking ledger** using **Event Sourcing + CQRS** patterns.

This repository is intentionally architecture-first: the focus is on domain design, consistency boundaries, event flows, and operational concerns that matter in production systems.

---

## 1) Domain Goals

The system supports the following core capabilities:

1. Create accounts
2. Deposit money
3. Withdraw money
4. Transfer money
5. Freeze/unfreeze accounts
6. Reverse transactions

Design objectives:

- Full auditability (append-only immutable history)
- Deterministic aggregate reconstruction
- Strong consistency per aggregate via optimistic concurrency
- Read scalability through projections
- Replayability for debugging and model evolution
- Long-term performance through snapshots
- Reliable multi-aggregate transfer orchestration via saga/process manager

---

## 2) Ubiquitous Language

- **Account**: A ledger account owned by a customer.
- **Ledger Entry**: A debit or credit movement attached to a transaction.
- **Transaction**: Business action represented by one or more events.
- **Aggregate**: Consistency boundary; here, usually `Account`.
- **Command**: Intent to change state (`DepositMoney`, `TransferMoney`, etc.).
- **Event**: Fact that already happened (`MoneyDeposited`, `TransferCompleted`).
- **Projection**: Read model built from event stream(s).
- **Saga**: Long-running orchestrator handling multi-step workflow across aggregates.

---

## 3) High-Level Architecture

```text
Clients/API
   |
   v
Command API (write side)
   |
   +--> Command Handlers --> Aggregate Rehydration --> Domain Decision --> New Events
                                  ^                               |
                                  |                               v
                             Event Store <--- Append (expected version)
                                  |
                                  +--> Event Bus / Subscription --> Projections (read side)
                                  |
                                  +--> Sagas / Process Managers

Read API (query side) <----- Read Models / Projections
```

### Architectural split

- **Write model (command side)**
  - Enforces invariants and business rules.
  - Persists only events.
- **Read model (query side)**
  - Optimized denormalized projections for API queries.
  - Eventually consistent with write model.

---

## 4) Event Store Design (Append-Only)

At minimum, every persisted event should include:

- `event_id` (UUID)
- `stream_id` (e.g., `account-{accountId}`)
- `stream_version` (monotonic per stream)
- `event_type`
- `event_data` (JSON/Avro/Protobuf payload)
- `event_metadata`:
  - `correlation_id` (tracks request flow)
  - `causation_id` (what event/command caused this)
  - `command_id` (idempotency key)
  - `actor`, `tenant`, `trace_id`
- `recorded_at` (UTC timestamp)

### Suggested streams

- Account stream: `account-{id}`
- Transfer stream (optional orchestration stream): `transfer-{id}`

### Global ordering

Maintain a global sequence/checkpoint (e.g., `position`) to:

- drive projection subscriptions,
- resume consumers from last checkpoint,
- enable deterministic replay over the whole system.

---

## 5) Aggregate Model & Invariants

## 5.1 Account Aggregate

Representative state:

- `account_id`
- `owner_id`
- `status` (`ACTIVE`, `FROZEN`, `CLOSED`)
- `currency`
- `available_balance`
- `held_balance` (optional for authorization flows)
- `version`

Key invariants:

- Cannot withdraw/transfer if account is frozen.
- Cannot overdraw unless overdraft policy allows it.
- Currency mismatch is rejected.
- Account must exist and be active for money movement.
- Reversal can only target a reversible, existing, and not-yet-reversed transaction.

## 5.2 Command → Event examples

- `CreateAccount` → `AccountCreated`
- `DepositMoney` → `MoneyDeposited`
- `WithdrawMoney` → `MoneyWithdrawn`
- `FreezeAccount` → `AccountFrozen`
- `UnfreezeAccount` → `AccountUnfrozen`
- `RequestTransactionReversal` → `TransactionReversalRequested`
- `ApproveTransactionReversal` → `TransactionReversed`

---

## 6) Core Event Catalog

### Account lifecycle

- `AccountCreated`
- `AccountFrozen`
- `AccountUnfrozen`
- `AccountClosed` (optional)

### Money movement

- `MoneyDeposited`
- `MoneyWithdrawn`

### Transfer workflow events

- `TransferInitiated`
- `TransferDebitReserved` *(optional if using holds)*
- `TransferDebited`
- `TransferCredited`
- `TransferCompleted`
- `TransferFailed`
- `TransferCompensated` *(if partial completion needs compensation)*

### Reversal events

- `TransactionReversalRequested`
- `TransactionReversalApproved` / `TransactionReversalRejected`
- `TransactionReversed`

Each event should carry:

- idempotency key (`command_id`),
- business reference (`transaction_id`, `transfer_id`),
- monetary details (`amount`, `currency`),
- reason codes for compliance/audit.

---

## 7) Optimistic Concurrency Control

Use expected stream version on append:

- load aggregate from stream with current version `v`
- compute new events
- append with `expected_version = v`
- if conflict: reject and retry command with fresh state

This prevents lost updates without global locks.

Conflict handling strategy:

1. Detect `WrongExpectedVersion`
2. Reload stream
3. Re-evaluate command against latest aggregate state
4. Retry if still valid; otherwise return business error

---

## 8) Projections (Read Models)

Create multiple projections for different query patterns:

1. **AccountSummaryProjection**
   - account status, available balance, current version
2. **AccountStatementProjection**
   - chronological transaction list with running balance
3. **TransferStatusProjection**
   - transfer lifecycle state machine for API/UI
4. **DailyLedgerProjection**
   - totals by currency/day for reporting and reconciliation

Projection rules:

- Subscribe by global position.
- Store checkpoint atomically with projection update.
- Ensure idempotency (`event_id` dedupe table or upsert patterns).
- Support rebuild from zero (drop + replay).

---

## 9) Event Replay Strategy

Replay is mandatory for:

- rebuilding new projections,
- fixing projection bugs,
- schema evolution backfills,
- audit investigations.

Operational recommendations:

- Keep replay separate from live consumers where possible.
- Throttle and batch replay to avoid DB saturation.
- Use feature flags when switching from old to rebuilt projection.
- Record replay metrics (lag, events/sec, failures).

---

## 10) Snapshotting Strategy

Snapshots optimize aggregate load time for long streams.

### Snapshot policy (example)

- Snapshot every `N=100` events per account stream, or
- Snapshot when rehydrate time crosses threshold.

### Snapshot content

- aggregate materialized state
- last applied stream version
- snapshot timestamp

### Rehydrate algorithm

1. Load latest snapshot for stream
2. Load events after `snapshot.version`
3. Apply remaining events
4. Return aggregate with final version

Important: snapshots are a performance optimization only; **events remain source of truth**.

---

## 11) Transfer Saga / Process Manager

Transfers involve two accounts (`source`, `destination`) and cannot be atomically committed across two streams without distributed transactions.

Use a **Saga** to orchestrate reliably:

1. `TransferInitiated`
2. Validate source/destination status + currency rules
3. Issue `DebitSourceAccount` command
4. On success, issue `CreditDestinationAccount` command
5. If credit fails after debit success, trigger compensation (`RefundSourceAccount`) and emit `TransferCompensated`
6. Emit terminal event: `TransferCompleted` or `TransferFailed`

### Saga design considerations

- Persist saga state (step, retries, timeout deadlines).
- Use correlation IDs for all transfer-related events.
- Make every saga command idempotent.
- Add retry policy with exponential backoff and dead-letter handling.
- Add timeout handling (e.g., stuck transfer auto-fail + compensation).

---

## 12) Reversal Design

Reversals should be explicit business operations, not event deletion.

Rules:

- Original event remains immutable.
- Reversal emits new compensating events.
- Track `reverses_transaction_id` and `reversed_by_transaction_id` links.
- Enforce single-reversal rule unless policy supports multi-stage corrections.
- Require reason + actor metadata for compliance.

---

## 13) Non-Functional Requirements (Real-World Mindset)

- **Audit & Compliance**: immutable logs, traceability, reason codes, actor identity.
- **Security**: authN/authZ, encryption at rest/in transit, least privilege for projection consumers.
- **Observability**:
  - command latency,
  - event append failures,
  - projection lag,
  - saga failure/compensation counts.
- **Resilience**: idempotent handlers, retries, poison-message strategy.
- **Data governance**: schema versioning and upcasters for old events.

---

## 14) Suggested Implementation Roadmap

### Phase 1: Core write model

- Implement event store abstraction + append/read APIs.
- Implement Account aggregate + commands/events.
- Add optimistic concurrency and idempotency keys.

### Phase 2: Read model basics

- Build account summary and statement projections.
- Add checkpointing and replay tooling.

### Phase 3: Transfers + saga

- Implement transfer saga with retries/timeouts.
- Add transfer status projection.

### Phase 4: Snapshots + operations

- Add snapshot store and rehydration optimization.
- Add replay CLI and observability dashboards.

### Phase 5: Advanced banking behavior

- Reversal workflows with approvals.
- Holds/authorizations and settlement windows.
- Multi-currency and FX policies (optional).

---

## 15) Example Command Flow (Withdraw)

1. API receives `WithdrawMoney(accountId, amount, commandId)`
2. Handler loads account stream (or snapshot + tail events)
3. Aggregate validates business rules (status, funds, currency)
4. Aggregate emits `MoneyWithdrawn`
5. Event store append with expected version
6. Projection updates account summary and statement
7. Query API returns updated balance after projection catch-up (or read-your-own-write strategy)

---

## 16) Next Step in This Repo

If you want, the next practical step is to scaffold a minimal codebase with:

- domain model (`Account` aggregate + events + command handlers),
- pluggable event store interface,
- in-memory event store for tests,
- projection worker with checkpointing,
- transfer saga state machine.

This keeps the project focused on learning **real event-driven banking internals** rather than CRUD scaffolding.
