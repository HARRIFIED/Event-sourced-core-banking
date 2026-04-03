import { Injectable } from '@nestjs/common';
import { DomainEvent } from '../../common/domain/domain-event';
import { AppendOptions, EventStore } from './event-store.interface';
import { OUTBOX_STORE, OutboxStore } from '../outbox/outbox-store.interface';
import { Inject } from '@nestjs/common';

@Injectable()
export class InMemoryEventStore implements EventStore {
  private readonly streams = new Map<string, DomainEvent[]>();
  private readonly allEvents: Array<DomainEvent & { position: number }> = [];

  constructor(@Inject(OUTBOX_STORE) private readonly outboxStore: OutboxStore) {}

  async append(streamId: string, events: DomainEvent[], options: AppendOptions): Promise<void> {
    const current = this.streams.get(streamId) ?? [];
    const currentVersion = current.length;

    if (options.expectedVersion !== currentVersion) {
      throw new Error(
        `WrongExpectedVersion for stream ${streamId}. Expected ${options.expectedVersion}, actual ${currentVersion}`,
      );
    }

    const appended = events.map((event, index) => ({
      ...event,
      streamVersion: currentVersion + index + 1,
    }));

    this.streams.set(streamId, [...current, ...appended]);

    appended.forEach((event) => {
      this.allEvents.push({
        ...event,
        position: this.allEvents.length + 1,
      });
    });

    await this.outboxStore.stage(
      appended.map((event) => ({
        id: event.eventId,
        topic: this.topicForStream(streamId),
        messageKey: streamId,
        payload: event,
        createdAt: event.occurredAt,
        attempts: 0,
        publishedAt: null,
        lastError: null,
      })),
    );
  }

  async readStream(streamId: string, fromVersion = 0): Promise<DomainEvent[]> {
    const current = this.streams.get(streamId) ?? [];
    return current.filter((event) => event.streamVersion > fromVersion);
  }

  async readAll(fromPosition = 0, maxCount = 1000): Promise<(DomainEvent & { position: number })[]> {
    return this.allEvents
      .filter((event) => event.position > fromPosition)
      .slice(0, maxCount);
  }

  private topicForStream(streamId: string): string {
    return `${streamId.split('-')[0]}-events`;
  }
}
