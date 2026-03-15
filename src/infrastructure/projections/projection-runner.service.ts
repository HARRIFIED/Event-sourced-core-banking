import { Inject, Injectable, Logger } from '@nestjs/common';
import { EVENT_STORE, EventStore } from '../event-store/event-store.interface';

@Injectable()
export class ProjectionRunnerService {
  private readonly logger = new Logger(ProjectionRunnerService.name);

  constructor(@Inject(EVENT_STORE) private readonly eventStore: EventStore) {}

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
        this.logger.debug(`Projecting event ${event.eventType} at position ${event.position}`);
        checkpoint = event.position;
      }
    }

    this.logger.log(`Projection replay completed at position ${checkpoint}`);
  }
}
