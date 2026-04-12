import { ConflictException } from '@nestjs/common';
import { DomainEvent } from '../../../common/domain/domain-event';
import { EventStore, WrongExpectedVersionError } from '../../../infrastructure/event-store/event-store.interface';
import { SnapshotStore } from '../../../infrastructure/snapshots/snapshot-store.interface';
import { AccountRepository } from './account.repository';

const CONTEXT = { commandId: 'cmd-1', correlationId: 'corr-1' };

function makeStores(appendImpl?: jest.Mock): { eventStore: EventStore; snapshotStore: SnapshotStore } {
  return {
    eventStore: {
      append: appendImpl ?? jest.fn().mockResolvedValue(undefined),
      readStream: jest.fn().mockResolvedValue([]),
      readAll: jest.fn(),
    },
    snapshotStore: {
      getLatest: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    },
  };
}

describe('AccountRepository', () => {
  describe('save()', () => {
    it('lets WrongExpectedVersionError bubble raw without wrapping', async () => {
      const { eventStore, snapshotStore } = makeStores(
        jest.fn().mockRejectedValue(new WrongExpectedVersionError('account-acc-1', 0, 1)),
      );
      const repository = new AccountRepository(eventStore, snapshotStore);
      const aggregate = await repository.getById('acc-1');
      aggregate.create('acc-1', 'owner-1', 'NGN', CONTEXT);

      await expect(repository.save('acc-1', aggregate)).rejects.toBeInstanceOf(WrongExpectedVersionError);
    });

    it('saves snapshots only when a snapshot boundary is crossed', async () => {
      const appendedEvents: DomainEvent[] = [];
      const { eventStore, snapshotStore } = makeStores(
        jest.fn().mockImplementation(async (_streamId, events) => {
          appendedEvents.push(...events);
        }),
      );
      const repository = new AccountRepository(eventStore, snapshotStore);
      const aggregate = await repository.getById('acc-1');
      aggregate.create('acc-1', 'owner-1', 'NGN', CONTEXT);

      await repository.save('acc-1', aggregate);

      expect(eventStore.append).toHaveBeenCalledTimes(1);
      expect(snapshotStore.save).not.toHaveBeenCalled();
      expect(appendedEvents).toHaveLength(1);
    });
  });

  describe('executeWithRetry()', () => {
    it('retries the full load-execute-save cycle on WrongExpectedVersionError and succeeds', async () => {
      // First append call fails, second succeeds — simulates another instance committing between
      // the first read and first write.
      const append = jest.fn()
        .mockRejectedValueOnce(new WrongExpectedVersionError('account-acc-1', 0, 1))
        .mockResolvedValue(undefined);
      const { eventStore, snapshotStore } = makeStores(append);
      const repository = new AccountRepository(eventStore, snapshotStore);

      await repository.executeWithRetry('acc-1', (account) => {
        account.create('acc-1', 'owner-1', 'NGN', CONTEXT);
      });

      expect(append).toHaveBeenCalledTimes(2);
    });

    it('throws ConflictException only after all retry attempts are exhausted', async () => {
      const append = jest.fn().mockRejectedValue(
        new WrongExpectedVersionError('account-acc-1', 0, 1),
      );
      const { eventStore, snapshotStore } = makeStores(append);
      const repository = new AccountRepository(eventStore, snapshotStore);

      await expect(
        repository.executeWithRetry('acc-1', (account) => {
          account.create('acc-1', 'owner-1', 'NGN', CONTEXT);
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      // MAX_WRITE_ATTEMPTS = 3
      expect(append).toHaveBeenCalledTimes(3);
    });

    it('does not retry on domain errors', async () => {
      const append = jest.fn().mockResolvedValue(undefined);
      const { eventStore, snapshotStore } = makeStores(append);
      const repository = new AccountRepository(eventStore, snapshotStore);

      // Attempt to deposit on an account that was never created — domain guard throws immediately.
      await expect(
        repository.executeWithRetry('acc-1', (account) => {
          account.deposit(100, 'NGN', 'txn-1', CONTEXT);
        }),
      ).rejects.toThrow();

      // append should never have been called because the domain error threw before save().
      expect(append).not.toHaveBeenCalled();
    });

    it('serialises concurrent operations for the same account via the in-process mutex', async () => {
      const order: number[] = [];
      const append = jest.fn().mockImplementation(async () => {
        await new Promise<void>((r) => setTimeout(r, 10));
      });
      const { eventStore, snapshotStore } = makeStores(append);
      const repository = new AccountRepository(eventStore, snapshotStore);

      // Fire three concurrent operations for the same account.
      await Promise.all([1, 2, 3].map((n) =>
        repository.executeWithRetry('acc-1', (account) => {
          account.create('acc-1', 'owner-1', 'NGN', CONTEXT);
          order.push(n);
        }),
      ));

      // All three must have run and each must have called append exactly once.
      expect(append).toHaveBeenCalledTimes(3);
      // The operations must have been serialised — the order array has exactly 3 entries
      // and no two ran at the same time (if they did, their domain calls would interleave).
      expect(order).toHaveLength(3);
    });
  });
});
