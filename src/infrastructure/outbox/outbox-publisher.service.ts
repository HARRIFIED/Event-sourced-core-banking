import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaClient } from '../messaging/kafka.client';
import { OUTBOX_STORE, OutboxStore } from './outbox-store.interface';

@Injectable()
export class OutboxPublisherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private readonly batchSize = 100;
  private readonly pollIntervalMs = 1000;
  private isRunning = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    @Inject(OUTBOX_STORE) private readonly outboxStore: OutboxStore,
    private readonly kafkaClient: KafkaClient,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit(): void {
    const storeKind = this.configService.get<string>('EVENT_STORE_KIND', 'in-memory');
    if (storeKind !== 'postgres') {
      return;
    }

    this.isRunning = true;
    this.loopPromise = this.runLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.isRunning = false;
    await this.loopPromise;
  }

  private async runLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        const messages = await this.outboxStore.claimPending(this.batchSize);
        if (messages.length === 0) {
          await this.sleep(this.pollIntervalMs);
          continue;
        }

        for (const message of messages) {
          try {
            await this.kafkaClient.publish(message.topic, message.messageKey, message.payload);
            await this.outboxStore.markPublished(message.id);
          } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            await this.outboxStore.markFailed(message.id, msg);
            this.logger.error(`Failed to publish outbox message ${message.id}: ${msg}`);
          }
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.error(`Outbox publisher loop failed: ${msg}`);
        await this.sleep(this.pollIntervalMs);
      }
    }
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
