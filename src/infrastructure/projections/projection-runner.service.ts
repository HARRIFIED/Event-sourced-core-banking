import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EVENT_STORE, EventStore } from '../event-store/event-store.interface';
import { AccountProjector } from '../../modules/accounts/query/account-projector.service';
import {
  ACCOUNT_READ_MODEL_REPOSITORY,
  AccountReadModelRepository,
} from '../../modules/accounts/query/account-read-model.repository';
import { MigrationRunnerService } from '../db/migration-runner.service';

@Injectable()
export class ProjectionRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectionRunnerService.name);
  private readonly projectionName = 'account-read-models';
  private readonly batchSize = 100;
  private readonly pollIntervalMs = 1000;
  private isRunning = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    @Inject(ACCOUNT_READ_MODEL_REPOSITORY)
    private readonly readModels: AccountReadModelRepository,
    private readonly accountProjector: AccountProjector,
    private readonly migrationRunner: MigrationRunnerService,
  ) {}

  onModuleInit(): void {
    this.isRunning = true;
    this.loopPromise = this.runLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.isRunning = false;
    await this.loopPromise;
  }

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

  private async runLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const checkpoint = await this.readModels.getCheckpoint(this.projectionName);
        const events = await this.eventStore.readAll(checkpoint, this.batchSize);

        if (events.length === 0) {
          await this.sleep(this.pollIntervalMs);
          continue;
        }

        for (const event of events) {
          const handled = await this.accountProjector.project(event);
          if (handled) {
            this.logger.debug(`Projected event ${event.eventType} at position ${event.position}`);
          }

          await this.readModels.saveCheckpoint(this.projectionName, event.position);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Projection loop failed: ${message}`);
        await this.sleep(this.pollIntervalMs);
      }
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
