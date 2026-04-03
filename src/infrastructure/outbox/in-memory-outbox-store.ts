import { Injectable } from '@nestjs/common';
import { OutboxMessage, OutboxStore, PendingOutboxMessage } from './outbox-store.interface';

@Injectable()
export class InMemoryOutboxStore implements OutboxStore {
  private readonly messages = new Map<string, PendingOutboxMessage>();
  private readonly claimed = new Set<string>();

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

  async claimPending(limit = 100): Promise<PendingOutboxMessage[]> {
    const pending = [...this.messages.values()]
      .filter((message) => !message.publishedAt && !this.claimed.has(message.id))
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .slice(0, limit);

    pending.forEach((message) => this.claimed.add(message.id));
    return pending;
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
    this.claimed.delete(id);
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
    this.claimed.delete(id);
  }
}
