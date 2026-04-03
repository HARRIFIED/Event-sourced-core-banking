export interface OutboxMessage {
  id: string;
  topic: string;
  messageKey: string;
  payload: object;
  createdAt: string;
  publishedAt?: string | null;
  attempts: number;
  lastError?: string | null;
}

export interface PendingOutboxMessage extends OutboxMessage {}

export interface OutboxStore {
  stage(messages: OutboxMessage[]): Promise<void>;
  getPending(limit?: number): Promise<PendingOutboxMessage[]>;
  markPublished(id: string, publishedAt?: string): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
}

export const OUTBOX_STORE = Symbol('OUTBOX_STORE');
