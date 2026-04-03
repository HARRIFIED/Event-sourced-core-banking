import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EVENT_STORE, EventStore } from '../event-store/event-store.interface';
import { AccountProjector } from '../../modules/accounts/query/account-projector.service';

@Injectable()
export class ProjectionRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectionRunnerService.name);

  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
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
}
