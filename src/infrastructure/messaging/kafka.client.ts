import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Consumer, Kafka, Producer } from 'kafkajs';

@Injectable()
export class KafkaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaClient.name);
  private readonly brokers: string[];
  private readonly kafka: Kafka;
  private readonly producer: Producer;
  private readonly consumers = new Set<Consumer>();

  constructor(private readonly configService: ConfigService) {
    this.brokers = [this.configService.get<string>('KAFKA_BROKER', 'localhost:29092')];
    this.kafka = new Kafka({
      clientId: this.configService.get<string>('KAFKA_CLIENT_ID', 'core-banking-app'),
      brokers: this.brokers,
    });
    this.producer = this.kafka.producer();
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.producer.connect();
      this.logger.log(`Kafka producer connected to ${this.brokers.join(', ')}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Kafka producer failed to connect to ${this.brokers.join(', ')}. ` +
        `Original error: ${message}`,
      );
      throw error;
    }
  }

  async publish(topic: string, key: string, value: object): Promise<void> {
    await this.producer.send({
      topic,
      messages: [{ key, value: JSON.stringify(value) }],
    });
  }

  async createConsumer(groupId: string): Promise<Consumer> {
    const consumer = this.kafka.consumer({ groupId });
    await consumer.connect();
    this.consumers.add(consumer);
    return consumer;
  }

  getConfiguredBrokers(): string[] {
    return [...this.brokers];
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(
      [...this.consumers].map(async (consumer) => {
        await consumer.disconnect();
        this.consumers.delete(consumer);
      }),
    );
    await this.producer.disconnect();
  }
}
