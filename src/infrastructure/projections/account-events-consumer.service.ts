import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer } from 'kafkajs';
import { DomainEvent } from '../../common/domain/domain-event';
import { AccountProjector } from '../../modules/accounts/query/account-projector.service';
import { KafkaClient } from '../messaging/kafka.client';
import { ObservabilityService } from '../observability/observability.service';
import { ProjectionCoordinationService } from './projection-coordination.service';

@Injectable()
export class AccountEventsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountEventsConsumerService.name);
  private consumer: Consumer | null = null;

  constructor(
    private readonly kafkaClient: KafkaClient,
    private readonly accountProjector: AccountProjector,
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
      this.logger.log('Kafka live projection consumer for account-events is disabled by configuration.');
      return;
    }

    const groupId = this.configService.get<string>(
      'ACCOUNT_PROJECTION_CONSUMER_GROUP',
      'core-banking-account-projections',
    );

    try {
      this.consumer = await this.kafkaClient.createConsumer(groupId);
      await this.consumer.subscribe({ topic: 'account-events', fromBeginning: true });
      await this.consumer.run({
        eachMessage: async ({ message }) => {
          const startedAt = process.hrtime.bigint();
          if (!message.value) {
            return;
          }

          try {
            const event = JSON.parse(message.value.toString()) as DomainEvent;
            const handled = await this.projectionCoordination.runShared(() => this.accountProjector.project(event));
            const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
            this.observability.recordKafkaMessage(
              AccountEventsConsumerService.name,
              'account-events',
              'success',
              durationSeconds,
            );
            if (handled) {
              this.logger.debug(`Projected Kafka event ${event.eventType} v${event.streamVersion}`);
            }
          } catch (error) {
            const durationSeconds = Number(process.hrtime.bigint() - startedAt) / 1_000_000_000;
            this.observability.recordKafkaMessage(
              AccountEventsConsumerService.name,
              'account-events',
              'failure',
              durationSeconds,
            );
            throw error;
          }
        },
      });

      this.logger.log(
        `Kafka live projection consumer subscribed to account-events with group ${groupId} ` +
        `using brokers ${this.kafkaClient.getConfiguredBrokers().join(', ')}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Kafka live projection consumer failed to start. ` +
        `Configured brokers: ${this.kafkaClient.getConfiguredBrokers().join(', ')}. ` +
        `Original error: ${message}`,
      );
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    await this.consumer.stop();
    this.consumer = null;
  }
}
