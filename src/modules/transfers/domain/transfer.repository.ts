import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { EVENT_STORE, EventStore, WrongExpectedVersionError } from '../../../infrastructure/event-store/event-store.interface';
import { TransferAggregate } from './transfer.aggregate';

const MAX_WRITE_ATTEMPTS = 3;

@Injectable()
export class TransferRepository {
  private readonly transferLocks = new Map<string, Promise<unknown>>();

  constructor(@Inject(EVENT_STORE) private readonly eventStore: EventStore) {}

  // Retrieves the transfer aggregate by ID by loading its event history from the event store.
  async getById(transferId: string): Promise<TransferAggregate> {
    const aggregate = new TransferAggregate();
    aggregate.loadFromHistory(await this.eventStore.readStream(`transfer-${transferId}`));
    return aggregate;
  }

  /// Executes the given operation on the transfer aggregate with optimistic concurrency control and retry logic.
  async executeWithRetry(
    transferId: string,
    operation: (transfer: TransferAggregate) => void,
  ): Promise<void> {
    await this.withTransferLock(transferId, async () => {
      for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
        try {
          const transfer = await this.getById(transferId);
          operation(transfer);
          await this.save(transferId, transfer);
          return;
        } catch (error) {
          if (error instanceof WrongExpectedVersionError && attempt < MAX_WRITE_ATTEMPTS) {
            await new Promise<void>((resolve) => setTimeout(resolve, Math.random() * 30));
            continue;
          }

          if (error instanceof WrongExpectedVersionError) {
            throw new ConflictException(
              `Concurrent modification detected for transfer ${transferId}. All ${MAX_WRITE_ATTEMPTS} write attempts failed.`,
            );
          }

          throw error;
        }
      }
    });
  }

  async save(transferId: string, aggregate: TransferAggregate): Promise<void> {
    const events = aggregate.pullUncommittedEvents();
    if (events.length === 0) {
      return;
    }

    const expectedVersion = aggregate.version - events.length;
    await this.eventStore.append(`transfer-${transferId}`, events, { expectedVersion });
  }

  private async withTransferLock<T>(transferId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.transferLocks.get(transferId) ?? Promise.resolve();

    let release!: () => void;
    const lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.transferLocks.set(transferId, lock);

    try {
      await previous;
      return await fn();
    } finally {
      release();
      if (this.transferLocks.get(transferId) === lock) {
        this.transferLocks.delete(transferId);
      }
    }
  }
}
