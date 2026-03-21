import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { databaseProviders } from './db/database.providers';
import { EVENT_STORE } from './event-store/event-store.interface';
import { InMemoryEventStore } from './event-store/in-memory-event-store';
import { PostgresEventStore } from './event-store/postgres-event-store';
import { KafkaClient } from './messaging/kafka.client';
import { ProjectionRunnerService } from './projections/projection-runner.service';
import { InMemorySnapshotStore } from './snapshots/in-memory-snapshot-store';
import { PostgresSnapshotStore } from './snapshots/postgres-snapshot-store';
import { SNAPSHOT_STORE } from './snapshots/snapshot-store.interface';

@Module({
  providers: [
    ...databaseProviders,
    InMemoryEventStore,
    PostgresEventStore,
    InMemorySnapshotStore,
    PostgresSnapshotStore,
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
  ],
  exports: [EVENT_STORE, SNAPSHOT_STORE, KafkaClient, ProjectionRunnerService],
})
export class InfrastructureModule {}
