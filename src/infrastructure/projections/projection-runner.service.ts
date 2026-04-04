import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EVENT_STORE, EventStore } from '../event-store/event-store.interface';
import { AccountProjector } from '../../modules/accounts/query/account-projector.service';
import {
  ACCOUNT_READ_MODEL_REPOSITORY,
  AccountReadModelRepository,
} from '../../modules/accounts/query/account-read-model.repository';

@Injectable()
export class ProjectionRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectionRunnerService.name);

  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    @Inject(ACCOUNT_READ_MODEL_REPOSITORY)
    private readonly readModels: AccountReadModelRepository,
    private readonly accountProjector: AccountProjector,
  ) {}

  onModuleInit(): void {
    this.logger.log('Live DB polling projections are disabled. Use replayFrom() for manual rebuilds.');
  }

  async onModuleDestroy(): Promise<void> {}

  async replayFrom(position = 0): Promise<void> {
    let checkpoint = position;
    let hasMore = true;

    while (hasMore) {
      const events = await this.eventStore.readAll(checkpoint, 1000);
      if (events.length === 0) {
        hasMore = false;
        break;
      }

      for (const event of events) {
        await this.accountProjector.project(event);
        checkpoint = event.position;
      }
    }

    this.logger.log(`Projection replay completed at position ${checkpoint}`);
  }
 // Additional helper methods for rebuilding specific account projections
  async rebuildAccount(accountId: string): Promise<void> {
    const streamId = `account-${accountId}`;
    await this.readModels.resetAccount(accountId);
    const events = await this.eventStore.readStream(streamId);

    for (const event of events) {
      await this.accountProjector.project(event);
    }

    this.logger.log(`Projection rebuild completed for account ${accountId}`);
  }
  
  // Convenience method to rebuild all account projections from scratch
  async rebuildAll(): Promise<void> {
    await this.readModels.resetAll();
    await this.replayFrom(0);
    this.logger.log('Full projection rebuild completed from event store');
  }
}