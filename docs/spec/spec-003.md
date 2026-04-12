# Spec 003: Hot Account Concurrency Hardening

## Context

After the write model, outbox, Kafka live projections, command idempotency, and transaction registry were in place, a load test was introduced to stress the system under realistic concurrent conditions.

The load test targeted a hot-account pattern: a configurable percentage of accounts receive a disproportionate share of traffic. This reflects real banking workloads where certain accounts (merchants, high-volume wallets, shared accounts) are written to far more often than the average.

The full test run that exposed the problems:

```
--duration=120 --workers=50 --accounts=250 --seed-concurrency=25
--initial-deposit=25000 --hot-account-ratio=0.05 --hot-selection-rate=0.9
```

What that configuration means:

- 50 concurrent workers, each running a continuous request loop
- 250 seed accounts, of which 5% (12–13 accounts) are designated hot
- 90% of all write traffic targets those 12–13 accounts
- operation mix: deposit 35%, withdraw 30%, balance read 20%, history read 10%, create 5%

## Load Test Results

```
Total completed requests:  19,404
Total failed requests:      2,428
Overall failure rate:       12.5%
Average throughput:         155 req/s

[deposit]
  completed=6234  failed=1026
  statuses 201:5208, 409:1026
  top errors: "Concurrent modification detected for account ..."

[withdraw]
  completed=5511  failed=977
  statuses 201:4534, 409:977
  top errors: "Concurrent modification detected for account ..."

[getBalance]
  completed=3648  failed=274
  statuses 200:3374, 404:274

[getHistory]
  completed=1748  failed=151
  statuses 200:1597, 404:151

Write latency (deposit/withdraw):
  p50=405ms  p95=590ms  p99=685ms  max=935ms
```

## Problems Identified

### 1. Concurrent Writes Permanently Failed With 409

The primary failure mode was `409 Conflict`. 2,003 out of 2,428 total failures came from this source.

The existing optimistic concurrency mechanism worked correctly but had no recovery path:

1. Worker A loads account `acc-5` at stream version 5.
2. Worker B also loads account `acc-5` at stream version 5.
3. Worker A writes one event. The stream is now at version 6. Worker A returns 201.
4. Worker B tries to write with `expectedVersion = 5`. The event store sees the current version is 6, not 5.
5. A `WrongExpectedVersionError` is thrown.
6. The repository converts it directly to `ConflictException`.
7. A 409 is returned to the client.

The issue is that step 7 is not a correct outcome here. Worker B's request is a genuinely distinct operation. It passed idempotency checks. It passed the transaction registry check. The conflict is purely an infrastructure artefact of the race between two valid and separate commands. The right behaviour is to reload the latest aggregate state and retry the operation, not to reject the request.

Because no retry existed, every race that lost became a permanent failure visible to the client. Under high hot-account pressure with 50 concurrent workers, this was unavoidable.

### 2. All Concurrent In-Process Requests Raced Without Coordination

Even though `pg_advisory_xact_lock` serializes the actual database write per stream, the aggregate is loaded **before** that lock is acquired. With 50 workers all targeting the same 12 accounts, many workers were loading stale aggregate versions at the same time.

The sequence looked like this for three concurrent workers hitting `acc-8`:

```
Worker A: load acc-8 at v10
Worker B: load acc-8 at v10  (same version, different in-flight request)
Worker C: load acc-8 at v10  (same version, different in-flight request)

DB lock queue:
  Worker A: acquires lock, checks version (10 == 10 ✓), writes v11, commits, releases
  Worker B: acquires lock, checks version (11 != 10 ✗), rolls back → WrongExpectedVersionError
  Worker C: acquires lock, checks version (11 != 10 ✗), rolls back → WrongExpectedVersionError
```

Two out of three writes failed, even though all three were valid operations for different clients. The system had no way to coordinate in-process requests before they even reached Postgres.

### 3. Snapshot Interval Too Coarse For Hot Accounts

The snapshot boundary was set at every 100 stream versions.

Under the load test, hot accounts accumulated events very quickly. An account at version 180 would replay 80 events from the DB on every load because the last snapshot was at version 100. As versions grew, the tail replay grew with it. This increased per-write latency and added to DB read pressure on the hot streams.

### 4. Outbox Projection Lag Causing 404s On Read

425 read failures (274 balance + 151 history) were `404 Not Found`. These accounts existed in the event store but had not yet appeared in the `account_summary` projection.

The outbox publisher was polling every 1000ms. After an account was created, the read request could arrive within milliseconds, before the event had been claimed by the publisher, sent to Kafka, consumed, and projected. The 1 second polling gap widened this projection lag window, making 404s more frequent under load.

## Solutions Implemented

### 1. Server-Side Retry On Write Conflicts

The load-execute-save cycle was extracted into a new `executeWithRetry` method on `AccountRepository`.

Instead of converting `WrongExpectedVersionError` into an immediate 409, the method retries the entire cycle up to `MAX_WRITE_ATTEMPTS` times. On each retry, the aggregate is reloaded from its current stream state so the operation runs against the latest committed version.

```
Attempt 1: load acc-5 at v5 → deposit → save at v5 → WrongExpectedVersionError (v6 committed)
           wait 0–30ms (random jitter)
Attempt 2: load acc-5 at v6 → deposit → save at v6 → success ✓
```

Key design decisions:

- Only `WrongExpectedVersionError` triggers a retry. Domain errors such as insufficient funds or a frozen account propagate immediately. They are not race conditions and retrying them would be incorrect.
- A 409 is only returned to the client after all attempts are exhausted, meaning three genuinely irrecoverable conflicts. This is rare in practice.
- A small random delay (0–30ms) is applied between attempts to spread retries from concurrent workers and reduce the chance of multiple workers retrying at the same instant.
- The `ConflictException` conversion was moved out of `save()` entirely. `save()` is now a pure infrastructure method that lets errors bubble without translation. The retry wrapper is the only place that produces a 409.

All four command handlers (`CreateAccountHandler`, `DepositMoneyHandler`, `WithdrawMoneyHandler`, `FreezeAccountHandler`) were updated to delegate to `executeWithRetry` instead of calling `getById` and `save` directly.

### 2. Per-Account In-Process Mutex

A per-account mutex was added to `AccountRepository` using promise chaining. This serialises concurrent requests for the same account within the same process before they reach Postgres.

```typescript
private readonly accountLocks = new Map<string, Promise<unknown>>();
```

How it works:

- The map holds the promise of the currently-running (or last-queued) operation for each accountId.
- When a new request arrives for an account that already has an in-flight operation, it chains onto the existing promise. It waits for the current holder to finish before it runs.
- The map entry is deleted when the last queued operation completes, so memory usage is bounded by the number of accounts with active in-flight requests, not the total account count.

With the mutex in place, the hot-account race described in Problem 2 no longer occurs for in-process concurrency:

```
Worker A: acquires lock, load acc-8 at v10, deposit, save at v11, release
Worker B: was waiting, load acc-8 at v11, deposit, save at v12, release
Worker C: was waiting, load acc-8 at v12, deposit, save at v13, release
```

Each worker loads fresh state after the previous one commits. `WrongExpectedVersionError` can only occur from a concurrent write from a separate process or instance. The retry loop handles that residual case.

The mutex wraps the entire retry loop inside `executeWithRetry`, so the two mechanisms work together:

- Same-process concurrency: handled by the mutex, no conflicts expected.
- Cross-instance concurrency: handled by the retry loop as a safety net.

### 3. Reduced Snapshot Interval

The snapshot boundary was reduced from 100 to 50 stream versions.

```typescript
const SNAPSHOT_INTERVAL = 50; // was 100
```

For hot accounts accumulating events rapidly, this halves the maximum tail replay length. An account at version 80 now has a snapshot at version 50 and replays only 30 events. Previously it would replay 80 events from the beginning.

Snapshots are still a write-side performance optimization only. The event stream remains the source of truth. Reducing the interval creates more snapshot rows but reduces load-time DB reads per write operation.

### 4. Reduced Outbox Poll Interval

The outbox publisher poll interval was reduced from 1000ms to 200ms.

```typescript
private readonly pollIntervalMs = 200; // was 1000
```

This narrows the window between an event being committed to the event store and it being claimed, published to Kafka, consumed, and projected into `account_summary`. Accounts created during the load test appear in the read model much sooner, reducing `404 Not Found` responses on balance and history reads.

## What Changed In Code

| File | Change |
|---|---|
| `src/modules/accounts/domain/account.repository.ts` | Added `accountLocks` map and `withAccountLock` private method. Added `executeWithRetry` public method. Removed `WrongExpectedVersionError` catch from `save()`. |
| `src/modules/accounts/application/handlers/account-command.handlers.ts` | All four handlers replaced manual `getById + execute + save` with `executeWithRetry`. Removed redundant `try/catch` blocks that only re-threw. |
| `src/infrastructure/outbox/outbox-publisher.service.ts` | `pollIntervalMs` reduced to 200. |

The snapshot interval change was applied directly to `SNAPSHOT_INTERVAL` in `account.repository.ts`.

## Expected Impact

| Problem | Before | After |
|---|---|---|
| 409 conflicts under hot-account load | ~2,003 per 120s run | Near zero for single-instance; residual cross-instance cases resolved by retry |
| In-process write races | All concurrent workers race to DB | Serialised per account in-process before reaching Postgres |
| Aggregate load replay length on hot accounts | Up to 99 events | Up to 49 events |
| Projection lag window after create | Up to 1000ms | Up to 200ms |
| Client-visible failure rate | 12.5% | Expected below 1% |

## Limitations Of These Fixes

**The in-process mutex is single-instance only.** In a horizontally scaled deployment with multiple app instances, the mutex provides no cross-instance protection. The retry loop remains the mechanism for that case. With three attempts and random jitter, cross-instance conflicts resolve within the first retry in most scenarios, but a robust multi-instance deployment should also consider queue-based per-account command serialisation at the infrastructure level.

**The retry loop increases tail latency under sustained cross-instance conflict.** Each retry adds a re-read round trip plus up to 30ms of jitter. This is acceptable for occasional conflicts but would compound under extreme multi-instance write pressure on the same account. That scenario is better addressed with an explicit per-account command queue.

**Projection 404s are not fully eliminated.** They are reduced significantly by the shorter poll interval, but eventual consistency means a very fast read-after-write can still arrive before the projection is updated. A read-your-own-write pattern (e.g. falling back to event store replay when the projection version is stale relative to a known write version) would address this completely, but was not in scope for this phase.
