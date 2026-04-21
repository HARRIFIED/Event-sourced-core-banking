import { randomUUID } from 'crypto';
import { InMemoryEventStore } from '../infrastructure/event-store/in-memory-event-store';
import { InMemoryOutboxStore } from '../infrastructure/outbox/in-memory-outbox-store';
import { InMemorySnapshotStore } from '../infrastructure/snapshots/in-memory-snapshot-store';
import { AccountEventTypes } from '../modules/accounts/application/events/account.events';
import { AccountRepository } from '../modules/accounts/domain/account.repository';
import { AccountProjector, ProjectionGapError } from '../modules/accounts/query/account-projector.service';
import { InMemoryAccountReadModelRepository } from '../modules/accounts/query/in-memory-account-read-model.repository';

function buildStack() {
  const outboxStore = new InMemoryOutboxStore();
  const eventStore = new InMemoryEventStore(outboxStore);
  const snapshotStore = new InMemorySnapshotStore();
  const repository = new AccountRepository(eventStore, snapshotStore);
  const readModelRepo = new InMemoryAccountReadModelRepository();
  const projector = new AccountProjector(readModelRepo);
  return { outboxStore, eventStore, snapshotStore, repository, readModelRepo, projector };
}

function ctx() {
  return { commandId: randomUUID(), correlationId: randomUUID() };
}

/**
 * Executes a sequence of account operations and returns the resulting domain events
 * in global position order from the in-memory event store. This lets projection tests
 * work against the exact event shapes the aggregate produces rather than hand-crafting
 * DomainEvent objects.
 */
async function writeAndReadEvents(
  setup: (stack: ReturnType<typeof buildStack>) => Promise<void>,
) {
  const stack = buildStack();
  await setup(stack);
  const events = await stack.eventStore.readAll(0, 100);
  return { stack, events };
}

describe('Kafka-driven projection update', () => {
  it('AccountCreated event creates an account_summary and an account_statement entry', async () => {
    const { events, stack } = await writeAndReadEvents(async ({ repository }) => {
      await repository.executeWithRetry('acc-proj-create', (acc) =>
        acc.create('acc-proj-create', 'owner-1', 'NGN', ctx()),
      );
    });

    const accountCreatedEvent = events.find(
      (e) => e.eventType === AccountEventTypes.AccountCreated,
    )!;
    await stack.projector.project(accountCreatedEvent);

    const summary = await stack.readModelRepo.getAccountSummary('acc-proj-create');
    expect(summary).not.toBeNull();
    expect(summary!.accountId).toBe('acc-proj-create');
    expect(summary!.ownerId).toBe('owner-1');
    expect(summary!.currency).toBe('NGN');
    expect(summary!.status).toBe('ACTIVE');
    expect(summary!.balance).toBe(0);
    expect(summary!.version).toBe(1);

    const statement = await stack.readModelRepo.getAccountStatement('acc-proj-create');
    expect(statement).toHaveLength(1);
    expect(statement[0].eventType).toBe(AccountEventTypes.AccountCreated);
    expect(statement[0].streamVersion).toBe(1);
  });

  it('MoneyDeposited event increases the balance in account_summary', async () => {
    const { events, stack } = await writeAndReadEvents(async ({ repository }) => {
      const accountId = 'acc-proj-deposit';
      const c = ctx();
      await repository.executeWithRetry(accountId, (acc) =>
        acc.create(accountId, 'owner-1', 'NGN', c),
      );
      await repository.executeWithRetry(accountId, (acc) =>
        acc.deposit(1000, 'NGN', 'txn-1', c),
      );
    });

    for (const event of events) {
      await stack.projector.project(event);
    }

    const summary = await stack.readModelRepo.getAccountSummary('acc-proj-deposit');
    expect(summary!.balance).toBe(1000);
    expect(summary!.version).toBe(2);

    const statement = await stack.readModelRepo.getAccountStatement('acc-proj-deposit');
    expect(statement).toHaveLength(2);
    expect(statement[1].eventType).toBe(AccountEventTypes.MoneyDeposited);
    expect(statement[1].amount).toBe(1000);
  });

  it('MoneyWithdrawn event decreases the balance in account_summary', async () => {
    const { events, stack } = await writeAndReadEvents(async ({ repository }) => {
      const accountId = 'acc-proj-withdraw';
      const c = ctx();
      await repository.executeWithRetry(accountId, (acc) =>
        acc.create(accountId, 'owner-1', 'NGN', c),
      );
      await repository.executeWithRetry(accountId, (acc) =>
        acc.deposit(1000, 'NGN', 'txn-dep', c),
      );
      await repository.executeWithRetry(accountId, (acc) =>
        acc.withdraw(300, 'NGN', 'txn-wd', c),
      );
    });

    for (const event of events) {
      await stack.projector.project(event);
    }

    const summary = await stack.readModelRepo.getAccountSummary('acc-proj-withdraw');
    expect(summary!.balance).toBe(700);
    expect(summary!.version).toBe(3);
  });

  it('AccountFrozen event sets status to FROZEN in account_summary', async () => {
    const { events, stack } = await writeAndReadEvents(async ({ repository }) => {
      const accountId = 'acc-proj-freeze';
      const c = ctx();
      await repository.executeWithRetry(accountId, (acc) =>
        acc.create(accountId, 'owner-1', 'NGN', c),
      );
      await repository.executeWithRetry(accountId, (acc) =>
        acc.freeze('compliance review', c),
      );
    });

    for (const event of events) {
      await stack.projector.project(event);
    }

    const summary = await stack.readModelRepo.getAccountSummary('acc-proj-freeze');
    expect(summary!.status).toBe('FROZEN');
    expect(summary!.version).toBe(2);

    const statement = await stack.readModelRepo.getAccountStatement('acc-proj-freeze');
    expect(statement[1].eventType).toBe(AccountEventTypes.AccountFrozen);
    expect(statement[1].reason).toBe('compliance review');
  });

  it('projecting the same event twice is idempotent', async () => {
    const { events, stack } = await writeAndReadEvents(async ({ repository }) => {
      const accountId = 'acc-proj-idem';
      const c = ctx();
      await repository.executeWithRetry(accountId, (acc) =>
        acc.create(accountId, 'owner-1', 'NGN', c),
      );
      await repository.executeWithRetry(accountId, (acc) =>
        acc.deposit(500, 'NGN', 'txn-1', c),
      );
    });

    const depositEvent = events.find((e) => e.eventType === AccountEventTypes.MoneyDeposited)!;

    // Project all events once to build the read model up to v2.
    for (const event of events) {
      await stack.projector.project(event);
    }

    // Re-project the deposit event (simulates Kafka redelivery after a consumer restart).
    await stack.projector.project(depositEvent);

    const summary = await stack.readModelRepo.getAccountSummary('acc-proj-idem');
    expect(summary!.balance).toBe(500); // must not become 1000
    expect(summary!.version).toBe(2);

    const statement = await stack.readModelRepo.getAccountStatement('acc-proj-idem');
    expect(statement).toHaveLength(2); // must not have a duplicate entry
  });

  it('throws ProjectionGapError when an event arrives out of sequence', async () => {
    const { events, stack } = await writeAndReadEvents(async ({ repository }) => {
      const accountId = 'acc-proj-gap';
      const c = ctx();
      await repository.executeWithRetry(accountId, (acc) =>
        acc.create(accountId, 'owner-1', 'NGN', c),
      );
      await repository.executeWithRetry(accountId, (acc) =>
        acc.deposit(100, 'NGN', 'txn-1', c),
      );
      await repository.executeWithRetry(accountId, (acc) =>
        acc.deposit(100, 'NGN', 'txn-2', c),
      );
    });

    // Project only the first event (AccountCreated v1). The projector now expects v2 next.
    await stack.projector.project(events[0]);

    // Skip v2 and attempt to project v3 — the projector must detect the gap.
    await expect(stack.projector.project(events[2])).rejects.toBeInstanceOf(ProjectionGapError);
  });
});
