import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer } from 'kafkajs';
import { DomainEvent } from '../../common/domain/domain-event';
import { AccountProjector } from '../../modules/accounts/query/account-projector.service';
import { KafkaClient } from '../messaging/kafka.client';

@Injectable()
export class AccountEventsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AccountEventsConsumerService.name);
  private consumer: Consumer | null = null;

  constructor(
    private readonly kafkaClient: KafkaClient,
    private readonly accountProjector: AccountProjector,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const storeKind = this.configService.get<string>('EVENT_STORE_KIND', 'in-memory');
    if (storeKind !== 'postgres') {
      return;
    }

    const groupId = this.configService.get<string>(
      'ACCOUNT_PROJECTION_CONSUMER_GROUP',
      'core-banking-account-projections',
    );

    this.consumer = await this.kafkaClient.createConsumer(groupId);
    await this.consumer.subscribe({ topic: 'account-events', fromBeginning: true });
    await this.consumer.run({
      eachMessage: async ({ message }) => {
        if (!message.value) {
          return;
        }

        const event = JSON.parse(message.value.toString()) as DomainEvent;
        const handled = await this.accountProjector.project(event);
        if (handled) {
          this.logger.debug(`Projected Kafka event ${event.eventType} v${event.streamVersion}`);
        }
      },
    });

    this.logger.log(`Kafka live projection consumer subscribed to account-events with group ${groupId}`);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.consumer) {
      return;
    }

    await this.consumer.stop();
    this.consumer = null;
  }
}
