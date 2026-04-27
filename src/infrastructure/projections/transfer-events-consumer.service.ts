import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer } from 'kafkajs';
import { DomainEvent } from '../../common/domain/domain-event';
import { KafkaClient } from '../messaging/kafka.client';
import { TransferProjector } from '../../modules/transfers/query/transfer-projector.service';

@Injectable()
export class TransferEventsConsumerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransferEventsConsumerService.name);
  private consumer: Consumer | null = null;

  constructor(
    private readonly kafkaClient: KafkaClient,
    private readonly transferProjector: TransferProjector,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit(): Promise<void> {
    const storeKind = this.configService.get<string>('EVENT_STORE_KIND', 'in-memory');
    if (storeKind !== 'postgres') {
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
        if (!message.value) {
          return;
        }

        const event = JSON.parse(message.value.toString()) as DomainEvent;
        await this.transferProjector.project(event);
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
