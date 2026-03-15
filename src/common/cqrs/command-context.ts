export interface CommandContext {
  commandId: string;
  correlationId: string;
  causationId?: string;
  actor?: string;
  traceId?: string;
}
