import { DomainEvent } from '../../common/domain/domain-event';

export interface AppendOptions {
  expectedVersion: number;
}

export class WrongExpectedVersionError extends Error {
  constructor(streamId: string, expectedVersion: number, actualVersion: number) {
    super(
      `WrongExpectedVersion for stream ${streamId}. Expected ${expectedVersion}, actual ${actualVersion}`,
    );
    this.name = 'WrongExpectedVersionError';
  }
}

export interface EventStore {
  append(streamId: string, events: DomainEvent[], options: AppendOptions): Promise<void>;
  readStream(streamId: string, fromVersion?: number): Promise<DomainEvent[]>;
  readAll(fromPosition?: number, maxCount?: number): Promise<(DomainEvent & { position: number })[]>;
}

export const EVENT_STORE = Symbol('EVENT_STORE');
