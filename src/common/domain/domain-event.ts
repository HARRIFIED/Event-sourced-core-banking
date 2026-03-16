export interface DomainEvent<TData = Record<string, unknown>> {
  readonly eventId: string;
  readonly streamId: string;
  readonly streamVersion: number;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly data: TData;
  readonly metadata: {
    correlationId: string;
    causationId?: string;
    commandId: string;
    actor?: string;
    traceId?: string;
  };
}
