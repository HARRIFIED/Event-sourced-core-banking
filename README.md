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
