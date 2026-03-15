import { DomainEvent } from '../../common/domain/domain-event';

export interface AppendOptions {
  expectedVersion: number;
}

export interface EventStore {
  append(streamId: string, events: DomainEvent[], options: AppendOptions): Promise<void>;
  readStream(streamId: string, fromVersion?: number): Promise<DomainEvent[]>;
  readAll(fromPosition?: number, maxCount?: number): Promise<(DomainEvent & { position: number })[]>;
}

export const EVENT_STORE = Symbol('EVENT_STORE');
