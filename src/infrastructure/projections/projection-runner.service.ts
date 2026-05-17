import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EVENT_STORE, EventStore } from '../event-store/event-store.interface';
import { AccountProjector } from '../../modules/accounts/query/account-projector.service';
import {
  ACCOUNT_READ_MODEL_REPOSITORY,
  AccountReadModelRepository,
} from '../../modules/accounts/query/account-read-model.repository';
import { TransferProjector } from '../../modules/transfers/query/transfer-projector.service';
import {
  TRANSFER_READ_MODEL_REPOSITORY,
  TransferReadModelRepository,
} from '../../modules/transfers/query/transfer-read-model.repository';
import { ProjectionCoordinationService } from './projection-coordination.service';

@Injectable()
export class ProjectionRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProjectionRunnerService.name);
  private isRunning = false;
  private loopPromise: Promise<void> | null = null;
  private checkpoint = 0;

  constructor(
    private readonly configService: ConfigService,
    @Inject(EVENT_STORE) private readonly eventStore: EventStore,
    @Inject(ACCOUNT_READ_MODEL_REPOSITORY)
    private readonly readModels: AccountReadModelRepository,
    @Inject(TRANSFER_READ_MODEL_REPOSITORY)
    private readonly transferReadModels: TransferReadModelRepository,
    private readonly accountProjector: AccountProjector,
    private readonly transferProjector: TransferProjector,
    private readonly projectionCoordination: ProjectionCoordinationService,
  ) {}

  onModuleInit(): void {
    const storeKind = this.configService.get<string>('EVENT_STORE_KIND', 'in-memory');
    if (storeKind !== 'in-memory') {
      this.logger.log('Live DB polling projections are disabled. Use replayFrom() for manual rebuilds.');
      return;
    }

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
        await this.transferProjector.project(event);
        checkpoint = event.position;
      }
    }

    this.logger.log(`Projection replay completed at position ${checkpoint}`);
  }
 // Additional helper methods for rebuilding specific account projections
  async rebuildAccount(accountId: string): Promise<void> {
    await this.projectionCoordination.runExclusive(`account rebuild for ${accountId}`, async () => {
      const streamId = `account-${accountId}`;
      await this.readModels.resetAccount(accountId);
      const events = await this.eventStore.readStream(streamId);

      for (const event of events) {
        await this.accountProjector.project(event);
      }

      this.logger.log(`Projection rebuild completed for account ${accountId}`);
    });
  }
  
  // Convenience method to rebuild all account projections from scratch
  async rebuildAll(): Promise<void> {
    await this.projectionCoordination.runExclusive('full projection rebuild', async () => {
      await this.readModels.resetAll();
      await this.transferReadModels.resetAll();
      await this.replayFrom(0);
      this.logger.log('Full projection rebuild completed from event store');
    });
  }

  async rebuildTransfer(transferId: string): Promise<void> {
    await this.projectionCoordination.runExclusive(`transfer rebuild for ${transferId}`, async () => {
      const streamId = `transfer-${transferId}`;
      await this.transferReadModels.resetTransfer(transferId);
      const events = await this.eventStore.readStream(streamId);

      for (const event of events) {
        await this.transferProjector.project(event);
      }

      this.logger.log(`Projection rebuild completed for transfer ${transferId}`);
    });
  }

  private async runLoop(): Promise<void> {
    while (this.isRunning) {
      const events = await this.eventStore.readAll(this.checkpoint, 1000);
      for (const event of events) {
        await this.accountProjector.project(event);
        await this.transferProjector.project(event);
        this.checkpoint = event.position;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}
