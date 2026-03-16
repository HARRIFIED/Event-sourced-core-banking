import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer } from 'kafkajs';

@Injectable()
export class KafkaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaClient.name);
  private readonly kafka: Kafka;
  private readonly producer: Producer;

  constructor(private readonly configService: ConfigService) {
    this.kafka = new Kafka({
      clientId: this.configService.get<string>('KAFKA_CLIENT_ID', 'core-banking-app'),
      brokers: [this.configService.get<string>('KAFKA_BROKER', 'localhost:9092')],
    });
    this.producer = this.kafka.producer();
  }

  async onModuleInit(): Promise<void> {
    await this.producer.connect();
    this.logger.log('Kafka producer connected');
  }

  async publish(topic: string, key: string, value: object): Promise<void> {
    await this.producer.send({
      topic,
      messages: [{ key, value: JSON.stringify(value) }],
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.producer.disconnect();
  }
}
