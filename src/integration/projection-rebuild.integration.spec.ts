import { randomUUID } from 'crypto';
import { InMemoryEventStore } from '../infrastructure/event-store/in-memory-event-store';
import { InMemoryOutboxStore } from '../infrastructure/outbox/in-memory-outbox-store';
import { ProjectionRunnerService } from '../infrastructure/projections/projection-runner.service';
import { InMemorySnapshotStore } from '../infrastructure/snapshots/in-memory-snapshot-store';
import { AccountEventTypes } from '../modules/accounts/application/events/account.events';
import { AccountRepository } from '../modules/accounts/domain/account.repository';
import { ProjectionGapError } from '../modules/accounts/query/account-projector.service';
import { AccountProjector } from '../modules/accounts/query/account-projector.service';
import { InMemoryAccountReadModelRepository } from '../modules/accounts/query/in-memory-account-read-model.repository';
import { InMemoryTransferReadModelRepository } from '../modules/transfers/query/in-memory-transfer-read-model.repository';
import { TransferProjector } from '../modules/transfers/query/transfer-projector.service';
import { ConfigService } from '@nestjs/config';

function buildStack() {
  const outboxStore = new InMemoryOutboxStore();
  const eventStore = new InMemoryEventStore(outboxStore);
  const snapshotStore = new InMemorySnapshotStore();
  const repository = new AccountRepository(eventStore, snapshotStore);
  const readModelRepo = new InMemoryAccountReadModelRepository();
  const transferReadModelRepo = new InMemoryTransferReadModelRepository();
  const projector = new AccountProjector(readModelRepo, transferReadModelRepo);
  const transferProjector = new TransferProjector(transferReadModelRepo);
  const projectionRunner = new ProjectionRunnerService(
    new ConfigService({ EVENT_STORE_KIND: 'in-memory' }),
    eventStore,
    readModelRepo,
    transferReadModelRepo,
    projector,
    transferProjector,
  );
  return {
    outboxStore,
    eventStore,
    snapshotStore,
    repository,
    readModelRepo,
    transferReadModelRepo,
    projector,
    transferProjector,
    projectionRunner,
  };
}

function ctx() {
  return { commandId: randomUUID(), correlationId: randomUUID() };
}

describe('Projection rebuild after drift', () => {
  it('replayFrom(0) rebuilds the correct read model after the read model is reset', async () => {
    const { repository, readModelRepo, projectionRunner } = buildStack();
    const accountId = 'acc-rebuild';
    const c = ctx();

    await repository.executeWithRetry(accountId, (acc) => acc.create(accountId, 'owner-1', 'NGN', c));
    await repository.executeWithRetry(accountId, (acc) => acc.deposit(1000, 'NGN', 'txn-1', c));
    await repository.executeWithRetry(accountId, (acc) => acc.withdraw(200, 'NGN', 'txn-2', c));

    // Do an initial replay to confirm the projection is correct first.
    await projectionRunner.replayFrom(0);
    const before = await readModelRepo.getAccountSummary(accountId);
    expect(before!.balance).toBe(800);

    // Simulate drift: wipe the read model.
    await readModelRepo.resetAll();
    expect(await readModelRepo.getAccountSummary(accountId)).toBeNull();

    // Rebuild.
    await projectionRunner.replayFrom(0);

    const after = await readModelRepo.getAccountSummary(accountId);
    expect(after!.balance).toBe(800);
    expect(after!.status).toBe('ACTIVE');
    expect(after!.version).toBe(3);

    const statement = await readModelRepo.getAccountStatement(accountId);
    expect(statement).toHaveLength(3);
  });

  it('rebuildAccount rebuilds only the target account without touching others', async () => {
    const { repository, readModelRepo, projectionRunner } = buildStack();
    const c = ctx();

    await repository.executeWithRetry('acc-target', (acc) => acc.create('acc-target', 'owner-1', 'NGN', c));
    await repository.executeWithRetry('acc-target', (acc) => acc.deposit(500, 'NGN', 'txn-a', c));
    await repository.executeWithRetry('acc-bystander', (acc) => acc.create('acc-bystander', 'owner-2', 'NGN', c));
    await repository.executeWithRetry('acc-bystander', (acc) => acc.deposit(300, 'NGN', 'txn-b', c));

    // Build both projections.
    await projectionRunner.replayFrom(0);

    // Corrupt the target account's read model only.
    await readModelRepo.resetAccount('acc-target');
    expect(await readModelRepo.getAccountSummary('acc-target')).toBeNull();

    // Rebuild only the target account.
    await projectionRunner.rebuildAccount('acc-target');

    expect((await readModelRepo.getAccountSummary('acc-target'))!.balance).toBe(500);
    // Bystander must be untouched.
    expect((await readModelRepo.getAccountSummary('acc-bystander'))!.balance).toBe(300);
  });

  it('rebuild is idempotent — running it twice produces the same result', async () => {
    const { repository, readModelRepo, projectionRunner } = buildStack();
    const accountId = 'acc-idem-rebuild';
    const c = ctx();

    await repository.executeWithRetry(accountId, (acc) => acc.create(accountId, 'owner-1', 'NGN', c));
    await repository.executeWithRetry(accountId, (acc) => acc.deposit(750, 'NGN', 'txn-1', c));

    await projectionRunner.rebuildAccount(accountId);
    const first = await readModelRepo.getAccountSummary(accountId);

    await projectionRunner.rebuildAccount(accountId);
    const second = await readModelRepo.getAccountSummary(accountId);

    expect(second!.balance).toBe(first!.balance);
    expect(second!.version).toBe(first!.version);

    const statement = await readModelRepo.getAccountStatement(accountId);
    expect(statement).toHaveLength(2); // must not have duplicates
  });

  it('gap in live projection is detected and then fully corrected by rebuildAccount', async () => {
    const { repository, readModelRepo, projector, projectionRunner, eventStore } = buildStack();
    const accountId = 'acc-gap-fix';
    const c = ctx();

    // Write three events: create (v1), deposit (v2), deposit (v3).
    await repository.executeWithRetry(accountId, (acc) => acc.create(accountId, 'owner-1', 'NGN', c));
    await repository.executeWithRetry(accountId, (acc) => acc.deposit(100, 'NGN', 'txn-1', c));
    await repository.executeWithRetry(accountId, (acc) => acc.deposit(100, 'NGN', 'txn-2', c));

    const allEvents = await eventStore.readAll(0, 10);
    const [v1, , v3] = allEvents; // deliberately skip v2 (index 1)

    // Simulate a live Kafka consumer that projects v1 correctly but misses v2.
    await projector.project(v1);

    // Projecting v3 while v2 is missing must throw a ProjectionGapError.
    await expect(projector.project(v3)).rejects.toBeInstanceOf(ProjectionGapError);

    // After the gap is detected, the read model is stuck at v1 (balance 0).
    expect((await readModelRepo.getAccountSummary(accountId))!.version).toBe(1);

    // An operator triggers a full account rebuild which replays from the event store.
    await projectionRunner.rebuildAccount(accountId);

    const repaired = await readModelRepo.getAccountSummary(accountId);
    expect(repaired!.version).toBe(3);
    expect(repaired!.balance).toBe(200); // both deposits applied

    const statement = await readModelRepo.getAccountStatement(accountId);
    expect(statement).toHaveLength(3);
  });

  it('rebuildAll rebuilds every account in the event store', async () => {
    const { repository, readModelRepo, projectionRunner } = buildStack();
    const accounts = ['acc-all-1', 'acc-all-2', 'acc-all-3'];
    const c = ctx();

    for (const id of accounts) {
      await repository.executeWithRetry(id, (acc) => acc.create(id, 'owner-1', 'NGN', c));
      await repository.executeWithRetry(id, (acc) => acc.deposit(400, 'NGN', `txn-${id}`, c));
    }

    await readModelRepo.resetAll();
    for (const id of accounts) {
      expect(await readModelRepo.getAccountSummary(id)).toBeNull();
    }

    await projectionRunner.rebuildAll();

    for (const id of accounts) {
      const summary = await readModelRepo.getAccountSummary(id);
      expect(summary!.balance).toBe(400);
      expect(summary!.version).toBe(2);
    }
  });
});
