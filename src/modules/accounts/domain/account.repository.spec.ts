import { ConflictException } from '@nestjs/common';
import { DomainEvent } from '../../../common/domain/domain-event';
import { EventStore, WrongExpectedVersionError } from '../../../infrastructure/event-store/event-store.interface';
import { SnapshotStore } from '../../../infrastructure/snapshots/snapshot-store.interface';
import { AccountRepository } from './account.repository';

describe('AccountRepository', () => {
  it('maps optimistic concurrency failures to ConflictException', async () => {
    const eventStore: EventStore = {
      append: jest.fn().mockRejectedValue(
        new WrongExpectedVersionError('account-acc-1', 1, 2),
      ),
      readStream: jest.fn().mockResolvedValue([]),
      readAll: jest.fn(),
    };
    const snapshotStore: SnapshotStore = {
      getLatest: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    };
    const repository = new AccountRepository(eventStore, snapshotStore);
    const aggregate = await repository.getById('acc-1');

    aggregate.create('acc-1', 'owner-1', 'NGN', {
      commandId: 'cmd-1',
      correlationId: 'corr-1',
    });

    await expect(repository.save('acc-1', aggregate)).rejects.toBeInstanceOf(ConflictException);
  });

  it('saves snapshots only when a snapshot boundary is crossed', async () => {
    const appendedEvents: DomainEvent[] = [];
    const eventStore: EventStore = {
      append: jest.fn().mockImplementation(async (_streamId, events) => {
        appendedEvents.push(...events);
      }),
      readStream: jest.fn().mockResolvedValue([]),
      readAll: jest.fn(),
    };
    const snapshotStore: SnapshotStore = {
      getLatest: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    };
    const repository = new AccountRepository(eventStore, snapshotStore);
    const aggregate = await repository.getById('acc-1');

    aggregate.create('acc-1', 'owner-1', 'NGN', {
      commandId: 'cmd-1',
      correlationId: 'corr-1',
    });

    await repository.save('acc-1', aggregate);

    expect(eventStore.append).toHaveBeenCalledTimes(1);
    expect(snapshotStore.save).not.toHaveBeenCalled();
    expect(appendedEvents).toHaveLength(1);
  });
});
