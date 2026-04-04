# Event-Sourced Core Banking

A NestJS learning project for building a realistic core banking or digital wallet backend with:

- Event sourcing for the write model
- CQRS for the write/read split
- Snapshotting for faster aggregate loads
- Background projections for query APIs
- PostgreSQL or in-memory infrastructure behind shared interfaces

## What This Repo Does Today

- Create, deposit into, withdraw from, and freeze accounts
- Persist account changes as immutable domain events
- Rehydrate aggregates from event history, using snapshots every 100 versions
- Maintain read models for account details, balances, and statement history
- Run background projection updates from the global event stream
- Track projection checkpoints so projection work resumes after restart
- Run lightweight versioned SQL migrations in Postgres mode

## Architecture

This repo uses a modular monolith with clear boundaries:

- `accounts` for account commands, aggregate logic, projections, and queries
- `transfers` for transfer orchestration scaffolding
- `infrastructure` for database access, event store, snapshots, projections, and messaging

High-level flow:

```text
Client
  |
  v
HTTP Controller
  |
  v
Command Handler
  |
  v
Load Aggregate (snapshot + tail events)
  |
  v
Domain Decision
  |
  v
Append Events to Event Store
  |
  +--> Background Projection Runner --> Read Tables
  |
  +--> Future Kafka / outbox integration
```

## Project Structure

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
    snapshots/
  modules/
    accounts/
      application/
      domain/
      query/
    transfers/
```

## Write Model

The write side is event sourced:

- the `AccountAggregate` enforces business rules
- the `AccountRepository` loads the aggregate from its stream
- new events are appended to the `events` table
- optimistic concurrency is enforced with `expectedVersion`

Example account stream:

1. `AccountCreated`
2. `MoneyDeposited`
3. `MoneyWithdrawn`
4. `AccountFrozen`

The current account state is rebuilt from those facts, not from a mutable `accounts` row.

## Snapshots

To avoid replaying very long account streams from version `1` every time, the repo stores snapshots:

- snapshot interval is currently `100` versions
- snapshots are a performance optimization only
- the event stream remains the source of truth

Aggregate load flow:

1. load latest snapshot for `account-{id}`
2. restore aggregate state from snapshot
3. read only events after the snapshot version
4. replay the remaining tail events

## Read Model

The query side is served from projections, not from aggregate rehydration during reads.

Current projection tables:

- `account_summary`
- `account_statement`
- `projection_checkpoints`

The background projection runner:

- reads new events from the global event stream
- projects account events into read tables
- stores its last processed position
- resumes from checkpoint after restart

This means the query side is eventually consistent with the write side.

## Storage Modes

`EVENT_STORE_KIND` controls which infrastructure implementation is used:

- `in-memory` for fast local learning and tests
- `postgres` for persistent event store, snapshots, and read models

In Postgres mode, the app uses:

- `events` for the append-only event log
- `snapshots` for aggregate snapshots
- `account_summary` for current account state
- `account_statement` for account history
- `projection_checkpoints` for projection progress
- `schema_migrations` for versioned SQL migrations

## Quickstart

### 1) Start dependencies

```bash
docker compose up -d postgres zookeeper kafka
```

### 2) Install dependencies

```bash
npm install
```

### 3) Bootstrap schema once for a fresh Postgres container

```bash
docker compose exec -T postgres psql -U banking -d banking -f /docker-entrypoint-initdb.d/init.sql
```

`init.sql` is useful for first-time container initialization. After that, incremental schema changes should be added as versioned migrations in:

`src/infrastructure/db/migrations/migrations.ts`

### 4) Run the app

```bash
npm run start:dev
```

Base URL:

- `http://localhost:3000/api`

Health check:

- `GET /health`

## Account Command Endpoints

Create account:

```bash
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -d "{\"accountId\":\"acc-1\",\"ownerId\":\"user-1\",\"currency\":\"USD\"}"
```

Deposit money:

```bash
curl -X POST http://localhost:3000/api/accounts/acc-1/deposits \
  -H "Content-Type: application/json" \
  -d "{\"amount\":1000,\"currency\":\"USD\",\"transactionId\":\"txn-1\"}"
```

Withdraw money:

```bash
curl -X POST http://localhost:3000/api/accounts/acc-1/withdrawals \
  -H "Content-Type: application/json" \
  -d "{\"amount\":200,\"currency\":\"USD\",\"transactionId\":\"txn-2\"}"
```

Freeze account:

```bash
curl -X POST http://localhost:3000/api/accounts/acc-1/freeze \
  -H "Content-Type: application/json" \
  -d "{\"reason\":\"compliance review\"}"
```

Transfer scaffolding:

```bash
curl -X POST http://localhost:3000/api/transfers \
  -H "Content-Type: application/json" \
  -d "{\"sourceAccountId\":\"acc-1\",\"destinationAccountId\":\"acc-2\",\"amount\":150,\"currency\":\"USD\"}"
```

## Account Query Endpoints

Get account details from `account_summary`:

```bash
curl http://localhost:3000/api/accounts/acc-1
```

Example response:

```json
{
  "accountId": "acc-1",
  "ownerId": "user-1",
  "currency": "USD",
  "status": "ACTIVE",
  "balance": 800,
  "version": 3,
  "createdAt": "2026-03-22T10:00:00.000Z",
  "updatedAt": "2026-03-22T10:05:00.000Z"
}
```

Get current balance:

```bash
curl http://localhost:3000/api/accounts/acc-1/balance
```

Get account history from `account_statement`:

```bash
curl "http://localhost:3000/api/accounts/acc-1/history?limit=50&offset=0"
```

## Projection Repair And Rebuild

If the read model falls behind or becomes inconsistent, rebuild it from the event store.

HTTP admin endpoints:

- `POST /api/admin/projections/accounts/:accountId/rebuild`
- `POST /api/admin/projections/accounts/rebuild-all`

Examples:

```bash
curl -X POST http://localhost:3000/api/admin/projections/accounts/acc-1/rebuild
```

```bash
curl -X POST http://localhost:3000/api/admin/projections/accounts/rebuild-all
```

CLI rebuild script:

```bash
npm run projections:rebuild -- account acc-1
```

```bash
npm run projections:rebuild -- all
```
Examole response:

```json
{
    "accountId": "100000",
    "entries": [
        {
            "eventId": "ab2db266-6610-4a7f-8ad4-fe10851523fc",
            "accountId": "100000",
            "streamVersion": 1,
            "eventType": "AccountCreated",
            "occurredAt": "2026-03-22T21:22:08.718Z"
        },
        {
            "eventId": "f5eecd0f-2981-4327-9652-83a1772c5424",
            "accountId": "100000",
            "streamVersion": 2,
            "eventType": "MoneyDeposited",
            "amount": 15000,
            "currency": "NGN",
            "transactionId": "txn-1",
            "occurredAt": "2026-03-22T21:26:04.083Z"
        },
        {
            "eventId": "fb917c12-f9e4-4f52-98ae-1dce314a7809",
            "accountId": "100000",
            "streamVersion": 3,
            "eventType": "MoneyDeposited",
            "amount": 25000,
            "currency": "NGN",
            "transactionId": "txn-1",
            "occurredAt": "2026-03-22T21:26:47.177Z"
        },
        {
            "eventId": "b4cbbcab-a5ba-424a-8e4a-cebd4eb3f074",
            "accountId": "100000",
            "streamVersion": 4,
            "eventType": "MoneyWithdrawn",
            "amount": 5000,
            "currency": "NGN",
            "transactionId": "txn-1",
            "occurredAt": "2026-03-22T21:31:35.785Z"
        }
    ]
}
```

## Eventual Consistency Note

Write endpoints return once the event is appended to the event store. Query endpoints read from projections updated by a background worker. Because of that:

- a write can succeed before the read model reflects it
- reads are usually very fast
- reads may lag briefly behind writes

That tradeoff is intentional in CQRS systems.

## Database And Migrations

This repo does not use an ORM.

Instead it uses:

- `pg` for direct SQL access
- a Nest provider called `PG_POOL` for shared connections
- a lightweight migration runner on app startup in Postgres mode

Migration flow:

1. app starts
2. if `EVENT_STORE_KIND=postgres`, the migration runner checks `schema_migrations`
3. pending migrations are applied in order
4. projection runner and repositories use the resulting schema

For new schema changes:

1. add a new migration object with the next version in `src/infrastructure/db/migrations/migrations.ts`
2. do not edit old migrations that may already be applied in real environments

## Environment Variables

Key environment variables:

- `PORT` default `3000`
- `EVENT_STORE_KIND` either `in-memory` or `postgres`
- `POSTGRES_HOST`
- `POSTGRES_PORT`
- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `KAFKA_BROKER`
- `KAFKA_CLIENT_ID`

See `.env.example`.

Kafka broker values depend on where the app runs:

- host machine with `npm run start:dev` -> `KAFKA_BROKER=localhost:29092`
- Docker Compose app container -> `KAFKA_BROKER=kafka:9092`

## Current Limitations

- account query projections are currently the only implemented read models
- projections are updated by an in-process poller, not Kafka consumers yet
- transfer flow is still scaffolding rather than a full durable saga
- no idempotency store for commands yet
- no read-your-own-write strategy yet for query-after-command UX

## Suggested Next Steps

1. Add replay tooling for rebuilding projections from zero.
2. Add transfer status projection and query endpoint.
3. Add an outbox pattern for reliable event publication.
4. Move projections to dedicated workers or Kafka consumers if needed.
5. Add command idempotency keyed by `commandId`.
6. Add integration tests covering concurrency conflicts and projection catch-up.
