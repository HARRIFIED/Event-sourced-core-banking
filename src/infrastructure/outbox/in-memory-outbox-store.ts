import { Injectable } from '@nestjs/common';
import { OutboxMessage, OutboxStore, PendingOutboxMessage } from './outbox-store.interface';

@Injectable()
export class InMemoryOutboxStore implements OutboxStore {
  private readonly messages = new Map<string, PendingOutboxMessage>();

  async stage(messages: OutboxMessage[]): Promise<void> {
    messages.forEach((message) => {
      if (this.messages.has(message.id)) {
        return;
      }

      this.messages.set(message.id, {
        ...message,
        publishedAt: message.publishedAt ?? null,
        lastError: message.lastError ?? null,
      });
    });
  }

  async getPending(limit = 100): Promise<PendingOutboxMessage[]> {
    return [...this.messages.values()]
      .filter((message) => !message.publishedAt)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);
  }

  async markPublished(id: string, publishedAt = new Date().toISOString()): Promise<void> {
    const current = this.messages.get(id);
    if (!current) {
      return;
    }

    this.messages.set(id, {
      ...current,
      publishedAt,
      lastError: null,
    });
  }

  async markFailed(id: string, error: string): Promise<void> {
    const current = this.messages.get(id);
    if (!current) {
      return;
    }

    this.messages.set(id, {
      ...current,
      attempts: current.attempts + 1,
      lastError: error,
    });
  }
}
