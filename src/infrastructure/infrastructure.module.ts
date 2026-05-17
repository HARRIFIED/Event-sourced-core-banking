import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { databaseProviders } from './db/database.providers';
import { MigrationRunnerService } from './db/migration-runner.service';
import { EVENT_STORE } from './event-store/event-store.interface';
import { InMemoryEventStore } from './event-store/in-memory-event-store';
import { PostgresEventStore } from './event-store/postgres-event-store';
import { IdempotencyService } from './idempotency/idempotency.service';
import { IDEMPOTENCY_RECORD_REPOSITORY } from './idempotency/idempotency-record.repository';
import { PostgresIdempotencyRecordRepository } from './idempotency/postgres-idempotency-record.repository';
import { InMemoryIdempotencyRecordRepository } from './idempotency/in-memory-idempotency-record.repository';
import { KafkaClient } from './messaging/kafka.client';
import { InMemoryOutboxStore } from './outbox/in-memory-outbox-store';
import { PostgresOutboxStore } from './outbox/postgres-outbox-store';
import { OUTBOX_STORE } from './outbox/outbox-store.interface';
import { OutboxPublisherService } from './outbox/outbox-publisher.service';
import { AccountEventsConsumerService } from './projections/account-events-consumer.service';
import { TransferEventsConsumerService } from './projections/transfer-events-consumer.service';
import { ProjectionAdminController } from './projections/projection-admin.controller';
import { ProjectionCoordinationService } from './projections/projection-coordination.service';
import { ProjectionRunnerService } from './projections/projection-runner.service';
import { InMemorySnapshotStore } from './snapshots/in-memory-snapshot-store';
import { PostgresSnapshotStore } from './snapshots/postgres-snapshot-store';
import { SNAPSHOT_STORE } from './snapshots/snapshot-store.interface';
import { InMemoryTransactionRecordRepository } from './transactions/in-memory-transaction-record.repository';
import { PostgresTransactionRecordRepository } from './transactions/postgres-transaction-record.repository';
import { TransactionRegistryService } from './transactions/transaction-registry.service';
import { TRANSACTION_RECORD_REPOSITORY } from './transactions/transaction-record.repository';
import { AccountProjector } from '../modules/accounts/query/account-projector.service';
import { ACCOUNT_READ_MODEL_REPOSITORY } from '../modules/accounts/query/account-read-model.repository';
import { InMemoryAccountReadModelRepository } from '../modules/accounts/query/in-memory-account-read-model.repository';
import { PostgresAccountReadModelRepository } from '../modules/accounts/query/postgres-account-read-model.repository';
import { InMemoryTransferReadModelRepository } from '../modules/transfers/query/in-memory-transfer-read-model.repository';
import { PostgresTransferReadModelRepository } from '../modules/transfers/query/postgres-transfer-read-model.repository';
import { TransferProjector } from '../modules/transfers/query/transfer-projector.service';
import { TRANSFER_READ_MODEL_REPOSITORY } from '../modules/transfers/query/transfer-read-model.repository';

@Module({
  controllers: [ProjectionAdminController],
  providers: [
    ...databaseProviders,
    MigrationRunnerService,
    InMemoryIdempotencyRecordRepository,
    PostgresIdempotencyRecordRepository,
    IdempotencyService,
    InMemoryTransactionRecordRepository,
    PostgresTransactionRecordRepository,
    TransactionRegistryService,
    InMemoryEventStore,
    PostgresEventStore,
    InMemoryOutboxStore,
    PostgresOutboxStore,
    InMemorySnapshotStore,
    PostgresSnapshotStore,
    InMemoryAccountReadModelRepository,
    PostgresAccountReadModelRepository,
    InMemoryTransferReadModelRepository,
    PostgresTransferReadModelRepository,
    AccountProjector,
    TransferProjector,
    KafkaClient,
    OutboxPublisherService,
    AccountEventsConsumerService,
    TransferEventsConsumerService,
    ProjectionCoordinationService,
    ProjectionRunnerService,
    {
      provide: IDEMPOTENCY_RECORD_REPOSITORY,
      inject: [ConfigService, InMemoryIdempotencyRecordRepository, PostgresIdempotencyRecordRepository],
      useFactory: (
        configService: ConfigService,
        inMemoryRepository: InMemoryIdempotencyRecordRepository,
        postgresRepository: PostgresIdempotencyRecordRepository,
      ) => {
        const storeKind = configService.get<string>('EVENT_STORE_KIND', 'in-memory');
        return storeKind === 'postgres' ? postgresRepository : inMemoryRepository;
      },
    },
    {
      provide: TRANSACTION_RECORD_REPOSITORY,
      inject: [ConfigService, InMemoryTransactionRecordRepository, PostgresTransactionRecordRepository],
      useFactory: (
        configService: ConfigService,
        inMemoryRepository: InMemoryTransactionRecordRepository,
        postgresRepository: PostgresTransactionRecordRepository,
      ) => {
        const storeKind = configService.get<string>('EVENT_STORE_KIND', 'in-memory');
        return storeKind === 'postgres' ? postgresRepository : inMemoryRepository;
      },
    },
    {
      provide: EVENT_STORE,
      inject: [ConfigService, InMemoryEventStore, PostgresEventStore],
      useFactory: (
        configService: ConfigService,
        inMemoryStore: InMemoryEventStore,
        postgresStore: PostgresEventStore,
      ) => {
        const storeKind = configService.get<string>('EVENT_STORE_KIND', 'in-memory');
        return storeKind === 'postgres' ? postgresStore : inMemoryStore;
      },
    },
    {
      provide: OUTBOX_STORE,
      inject: [ConfigService, InMemoryOutboxStore, PostgresOutboxStore],
      useFactory: (
        configService: ConfigService,
        inMemoryStore: InMemoryOutboxStore,
        postgresStore: PostgresOutboxStore,
      ) => {
        const storeKind = configService.get<string>('EVENT_STORE_KIND', 'in-memory');
        return storeKind === 'postgres' ? postgresStore : inMemoryStore;
      },
    },
    {
      provide: SNAPSHOT_STORE,
      inject: [ConfigService, InMemorySnapshotStore, PostgresSnapshotStore],
      useFactory: (
        configService: ConfigService,
        inMemoryStore: InMemorySnapshotStore,
        postgresStore: PostgresSnapshotStore,
      ) => {
        const storeKind = configService.get<string>('EVENT_STORE_KIND', 'in-memory');
        return storeKind === 'postgres' ? postgresStore : inMemoryStore;
      },
    },
    {
      provide: ACCOUNT_READ_MODEL_REPOSITORY,
      inject: [ConfigService, InMemoryAccountReadModelRepository, PostgresAccountReadModelRepository],
      useFactory: (
        configService: ConfigService,
        inMemoryRepository: InMemoryAccountReadModelRepository,
        postgresRepository: PostgresAccountReadModelRepository,
      ) => {
        const storeKind = configService.get<string>('EVENT_STORE_KIND', 'in-memory');
        return storeKind === 'postgres' ? postgresRepository : inMemoryRepository;
      },
    },
    {
      provide: TRANSFER_READ_MODEL_REPOSITORY,
      inject: [ConfigService, InMemoryTransferReadModelRepository, PostgresTransferReadModelRepository],
      useFactory: (
        configService: ConfigService,
        inMemoryRepository: InMemoryTransferReadModelRepository,
        postgresRepository: PostgresTransferReadModelRepository,
      ) => {
        const storeKind = configService.get<string>('EVENT_STORE_KIND', 'in-memory');
        return storeKind === 'postgres' ? postgresRepository : inMemoryRepository;
      },
    },
  ],
  exports: [
    ...databaseProviders,
    EVENT_STORE,
    OUTBOX_STORE,
    SNAPSHOT_STORE,
    ACCOUNT_READ_MODEL_REPOSITORY,
    TRANSFER_READ_MODEL_REPOSITORY,
    IDEMPOTENCY_RECORD_REPOSITORY,
    IdempotencyService,
    TRANSACTION_RECORD_REPOSITORY,
    TransactionRegistryService,
    KafkaClient,
    OutboxPublisherService,
    AccountEventsConsumerService,
    TransferEventsConsumerService,
    MigrationRunnerService,
    ProjectionRunnerService,
  ],
})
export class InfrastructureModule {}
