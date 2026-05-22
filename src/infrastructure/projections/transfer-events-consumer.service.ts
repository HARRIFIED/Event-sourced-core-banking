import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer } from 'kafkajs';
import { DomainEvent } from '../../common/domain/domain-event';
import { KafkaClient } from '../messaging/kafka.client';
import { TransferProjector } from '../../modules/transfers/query/transfer-projector.service';
import { ObservabilityService } from '../observability/observability.service';
import { ProjectionCoordinationService } from './projection-coordination.service';

@Injectable()
export class TransferEventsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransferEventsConsumerService.name);
  private consumer: Consumer | null = null;

  constructor(
    private readonly kafkaClient: KafkaClient,
    private readonly transferProjector: TransferProjector,
    private readonly configService: ConfigService,
    private readonly observability: ObservabilityService,
    private readonly projectionCoordination: ProjectionCoordinationService,
  ) {}

  async onModuleInit(): Promise<void> {
    const storeKind = this.configService.get<string>('EVENT_STORE_KIND', 'in-memory');
    if (storeKind !== 'postgres') {
      return;
    }

    const liveConsumersEnabled =
      this.configService.get<string>('PROJECTION_LIVE_CONSUMERS_ENABLED', 'true') !== 'false';
    if (!liveConsumersEnabled) {
      this.logger.log('Kafka live projection consumer for transfer-events is disabled by configuration.');
      return;
    }

    const groupId = this.configService.get<string>(
      'TRANSFER_PROJECTION_CONSUMER_GROUP',
      'core-banking-transfer-projections',
    );

    this.consumer = await this.kafkaClient.createConsumer(groupId);
    await this.consumer.subscribe({ topic: 'transfer-events', fromBeginning: true });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        const startedAt = process.hrtime.bigint();
        if (!message.value) {
          return;
        }

        try {
          const event = JSON.parse(message.value.toString()) as DomainEvent;
          await this.projectionCoordination.runShared(() => this.transferProjector.project(event));
          const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
          this.observability.recordKafkaMessage(
            TransferEventsConsumerService.name,
            'transfer-events',
            'success',
            durationSeconds,
          );
        } catch (error) {
          const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
          this.observability.recordKafkaMessage(
            TransferEventsConsumerService.name,
            'transfer-events',
            'failure',
            durationSeconds,
          );
          throw error;
        }
      },
    });

    this.logger.log(`Kafka live projection consumer subscribed to transfer-events with group ${groupId}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    await this.consumer.stop();
    this.consumer = null;
  }
}
