import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { databaseProviders } from './db/database.providers';
import { MigrationRunnerService } from './db/migration-runner.service';
import { EVENT_STORE } from './event-store/event-store.interface';
import { InMemoryEventStore } from './event-store/in-memory-event-store';
import { PostgresEventStore } from './event-store/postgres-event-store';
import { KafkaClient } from './messaging/kafka.client';
import { ProjectionRunnerService } from './projections/projection-runner.service';
import { InMemorySnapshotStore } from './snapshots/in-memory-snapshot-store';
import { PostgresSnapshotStore } from './snapshots/postgres-snapshot-store';
import { SNAPSHOT_STORE } from './snapshots/snapshot-store.interface';
import { AccountProjector } from '../modules/accounts/query/account-projector.service';
import { ACCOUNT_READ_MODEL_REPOSITORY } from '../modules/accounts/query/account-read-model.repository';
import { InMemoryAccountReadModelRepository } from '../modules/accounts/query/in-memory-account-read-model.repository';
import { PostgresAccountReadModelRepository } from '../modules/accounts/query/postgres-account-read-model.repository';

@Module({
  providers: [
    ...databaseProviders,
    MigrationRunnerService,
    InMemoryEventStore,
    PostgresEventStore,
    InMemorySnapshotStore,
    PostgresSnapshotStore,
    InMemoryAccountReadModelRepository,
    PostgresAccountReadModelRepository,
    AccountProjector,
    KafkaClient,
    ProjectionRunnerService,
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
  ],
  exports: [
    EVENT_STORE,
    SNAPSHOT_STORE,
    ACCOUNT_READ_MODEL_REPOSITORY,
    KafkaClient,
    MigrationRunnerService,
    ProjectionRunnerService,
  ],
})
export class InfrastructureModule {}
