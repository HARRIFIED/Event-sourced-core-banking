# Event-Sourced Core Banking

A NestJS learning project for building a realistic core banking or digital wallet backend with:

- Event sourcing for the write model
- CQRS for the write/read split
- Snapshotting for faster aggregate loads
- Kafka-driven live projections for query APIs
- PostgreSQL or in-memory infrastructure behind shared interfaces

## What This Repo Does Today

- Create, deposit into, withdraw from, and freeze accounts
- Initiate durable internal account-to-account transfers and track their status
- Persist account changes as immutable domain events
- Deduplicate account command retries with a Postgres-backed idempotency store
- Guard deposit and withdrawal business transactions with a write-side transaction registry
- Run debit-credit-compensation transfer orchestration with durable retry-safe leg tracking
- Rehydrate aggregates from event history, using snapshots every 50 versions
- Maintain read models for account details, balances, statement history, and transfer status
- Publish persisted events through a transactional outbox
- Update live account and transfer projections through Kafka consumers
- Keep manual replay and rebuild tooling backed by the event store
- Run lightweight versioned SQL migrations in Postgres mode

## Architecture Specs

Longer design context lives in:

- [docs/spec/spec-001.md](docs/spec/spec-001.md) for the baseline event-sourced write model, snapshots, and initial query side before outbox/Kafka live projection
- [docs/spec/spec-002.md](docs/spec/spec-002.md) for the outbox, Kafka live projections, projection gap handling, and rebuild tooling update
- [docs/spec/spec-003.md](docs/spec/spec-003.md) for hot-account concurrency hardening: server-side retry, per-account in-process mutex, snapshot tuning, and outbox poll interval reduction
- [docs/spec/spec-004.md](docs/spec/spec-004.md) for durable internal transfers, transfer projections, and compensation-based recovery

## Architecture

This repo uses a modular monolith with clear boundaries:

- `accounts` for account commands, aggregate logic, projections, and queries
- `transfers` for event-sourced transfer orchestration, status projections, and recovery
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
  +--> Transactional Outbox --> Kafka --> Live Projection Consumer --> Read Tables
  |
  +--> Manual Projection Replay / Rebuild From Event Store
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

- snapshot interval is currently `50` versions
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
- `transfer_summary`
- `projection_checkpoints`

Live account and transfer projection updates are Kafka-driven.

The manual projection runner remains in the codebase for:

- replay
- rebuild
- repair from source of truth

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
- `outbox_events` for reliable event publication
- `idempotency_records` for API-level command deduplication
- `transaction_records` for business transaction deduplication
- `transfer_summary` for transfer status tracking
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

All account command endpoints now require an `Idempotency-Key` header.

Use one unique key per logical operation, and reuse the same key only when retrying that exact same request.

Create account:

```bash
curl -X POST http://localhost:3000/api/accounts \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 2d3c5e2f-54fc-42b1-98d0-65f5fd4d6448" \
  -d "{\"accountId\":\"acc-1\",\"ownerId\":\"user-1\",\"currency\":\"USD\"}"
```

Deposit money:

```bash
curl -X POST http://localhost:3000/api/accounts/acc-1/deposits \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 4e8cb2bc-e8cf-4407-979d-b1e8ac25fe65" \
  -d "{\"amount\":1000,\"currency\":\"USD\",\"transactionId\":\"txn-1\"}"
```

Withdraw money:

```bash
curl -X POST http://localhost:3000/api/accounts/acc-1/withdrawals \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: cbcf3754-2e55-4ab2-b788-0ef2bbac7776" \
  -d "{\"amount\":200,\"currency\":\"USD\",\"transactionId\":\"txn-2\"}"
```

Freeze account:

```bash
curl -X POST http://localhost:3000/api/accounts/acc-1/freeze \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 197f5140-4516-4eb4-b10f-cf2cdfa4c906" \
  -d "{\"reason\":\"compliance review\"}"
```

Transfer initiation:

```bash
curl -X POST http://localhost:3000/api/transfers \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 4f2a1e1d-79a0-4f4c-96d1-635c5f85c3a4" \
  -d "{\"transferId\":\"trf-1\",\"sourceAccountId\":\"acc-1\",\"destinationAccountId\":\"acc-2\",\"amount\":150,\"currency\":\"USD\"}"
```

Transfer status:

```bash
curl http://localhost:3000/api/transfers/trf-1
```

Transfers are asynchronous:

- `POST /transfers` returns once the transfer intent is durably recorded
- the transfer coordinator drives debit, credit, and compensation in the background
- clients should follow up with `GET /transfers/:transferId` for the latest status

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

Example response:

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

## Local Load Testing

This repo now includes a mixed-workload load runner for local stress testing.

It is intentionally scenario-driven instead of a pure raw-HTTP benchmark so it can:

- create fresh accounts
- generate unique `Idempotency-Key` values
- generate unique deposit and withdrawal `transactionId` values
- mix reads and writes against the same account pool
- concentrate traffic on a hot subset of accounts to simulate real contention

Start the app first, then run:

```bash
npm run load:test
```

Useful flags:

- `--duration=60` total test length in seconds
- `--workers=20` number of concurrent request loops
- `--accounts=100` seed account count before the run starts
- `--seed-concurrency=10` concurrent account creation during setup
- `--initial-deposit=10000` opening balance per seeded account
- `--min-amount=100`
- `--max-amount=1500`
- `--base-url=http://localhost:3000/api`
- `--hot-account-ratio=0.1` top slice of accounts treated as hot
- `--hot-selection-rate=0.8` chance a request targets the hot slice
- `--deposit-weight=35`
- `--withdraw-weight=30`
- `--balance-weight=20`
- `--history-weight=10`
- `--create-weight=5`
- `--transfer-initiate-weight=0`
- `--transfer-status-weight=0`
- `--max-transfer-amount=1500`
- `--remove-completed-transfers-from-pool=false`

Example heavier run:

```bash
npm run load:test -- --duration=120 --workers=50 --accounts=250 --seed-concurrency=25 --initial-deposit=25000 --hot-account-ratio=0.05 --hot-selection-rate=0.9
```

Example heavier 5-minute transfer-focused run:

```bash
npm run load:test -- --base-url=http://localhost:8080/api --duration=300 --workers=80 --accounts=400 --seed-concurrency=40 --initial-deposit=50000 --hot-account-ratio=0.03 --hot-selection-rate=0.92 --deposit-weight=20 --withdraw-weight=15 --balance-weight=10 --history-weight=5 --create-weight=2 --transfer-initiate-weight=30 --transfer-status-weight=18 --max-transfer-amount=3000
```

What to watch for:

- `400` responses can be expected under aggressive withdrawal pressure because some requests will hit insufficient funds
- `409` responses from deposits and withdrawals now indicate a genuine write conflict that exhausted all server-side retry attempts — this should be rare under normal load
- `404` responses on balance or history reads can occur briefly after account creation because projections are asynchronous; they resolve quickly as the outbox publisher and Kafka consumer catch up
- `404` responses on transfer status reads can occur briefly if a status poll arrives before the transfer projection catches up
- `500` responses are unexpected and indicate a system fault worth investigating

If you want a pure endpoint throughput benchmark as a separate experiment, you can also use `autocannon` externally against a single route, but the built-in script is the better fit for realistic account workflow stress.

## Projection Repair And Rebuild

If the read model falls behind or becomes inconsistent, rebuild it from the event store.

HTTP admin endpoints:

- `POST /api/admin/projections/accounts/:accountId/rebuild`
- `POST /api/admin/projections/transfers/:transferId/rebuild`
- `POST /api/admin/projections/accounts/rebuild-all`

Examples:

```bash
curl -X POST http://localhost:3000/api/admin/projections/accounts/acc-1/rebuild
```

```bash
curl -X POST http://localhost:3000/api/admin/projections/accounts/rebuild-all
```

```bash
curl -X POST http://localhost:3000/api/admin/projections/transfers/trf-1/rebuild
```

CLI rebuild script:

```bash
npm run projections:rebuild -- account acc-1
```

```bash
npm run projections:rebuild -- all
```

```bash
npm run projections:rebuild -- transfer trf-1
```

## Eventual Consistency Note

Write endpoints return once the event is appended to the event store. Query endpoints read from projections updated asynchronously. Because of that:

- a write can succeed before the read model reflects it
- reads are usually very fast
- reads may lag briefly behind writes

That tradeoff is intentional in CQRS systems.

## Command Idempotency

Account command endpoints use a Postgres-backed `idempotency_records` table.

Behavior:

- first request with a new `Idempotency-Key` is processed normally
- retry with the same key and same payload returns the original success response
- retry with the same key while the first request is still in progress returns a conflict
- reusing the same key for a different payload returns a conflict

Client guidance:

- generate a UUID on the client for each logical command
- reuse that exact UUID only when retrying the same request
- do not generate a fresh key for retries, or the server will treat it as a new command

For deposits and withdrawals, the app also uses a Postgres-backed `transaction_records` table.

That means:

- `Idempotency-Key` protects the API request
- `transactionId` protects the business money movement

Even if a caller changes the `Idempotency-Key`, reusing the same `transactionId` for a deposit or withdrawal will not create a second business transaction.

Transfers use both layers too:

- `Idempotency-Key` deduplicates `POST /transfers`
- `transferId` is the stable business identifier for the transfer itself
- transfer leg transaction ids are derived from the transfer id so debit, credit, and compensation can be retried safely after crashes

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
4. outbox, projections, and repositories use the resulting schema

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

- transfers are currently internal only; no external rails or settlement integration yet
- transfers are same-currency only; no FX or exchange-rate handling
- no client-driven transfer cancellation yet
- no read-your-own-write strategy yet for query-after-command UX
- rebuild/admin endpoints are not authenticated yet
- Kafka-based live projections still need broader operational hardening such as monitoring, lag visibility, and richer failure handling

## Monitoring

The repo now exposes Prometheus-compatible application metrics at:

- `GET /metrics`

Key app metrics include:

- HTTP request rate, latency, and status codes
- process memory and CPU usage
- outbox publish throughput, failures, and backlog age
- Kafka consumer throughput and failures
- transfer debit, credit, and compensation stage throughput and latency

The local Docker stack also includes:

- Prometheus at `http://localhost:9090`
- Grafana at `http://localhost:3001`
- PostgreSQL exporter
- Kafka exporter
- cAdvisor

Bring the full stack up with:

```bash
docker compose up -d
```

Prometheus can scrape either:

- the Dockerized app, if you run the `app` service in Compose
- a locally running app, if you run Nest outside Docker

The scrape target is controlled through:

- `PORT`
- `PROMETHEUS_APP_TARGET`

Examples:

- app running locally on `8080`:
  `PORT=8080`
  `PROMETHEUS_APP_TARGET=host.docker.internal:8080`

- app running in Docker on `3000`:
  `PORT=3000`
  `PROMETHEUS_APP_TARGET=host.docker.internal:3000`

Useful URLs:

- app metrics: `http://localhost:3000/metrics`
- Prometheus: `http://localhost:9090`
- Grafana: `http://localhost:3001`

Default Grafana credentials:

- username: `admin`
- password: `admin`

Grafana provisions the `Core Banking Overview` dashboard automatically from the repo.

## Next Steps
1. Add richer operator tooling for stuck-transfer inspection and replay.
2. Add auth and audit logging for admin rebuild endpoints.
3. Add monitoring for outbox lag, consumer lag, transfer retries, and projection failures.
4. Add optional client-driven transfer cancellation with explicit lifecycle rules.
5. Explore balance holds or reservations as an alternative to immediate debit plus compensation.

## 🤝 Contributing

Contributions are welcome.
To keep things smooth and collaborative, please follow these best practices:

1. **Fork the repository**  
   Create your own copy of the repo to work on.

2. **Create a feature branch**  
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes**

  . Keep commits small and meaningful.
  
  . Follow existing code style and conventions.
  
  . Add/update tests where applicable.

4. **Run tests locally**
5. **Make sure to update the README and then create a spec file with your updates (See previous file for inspo)**






