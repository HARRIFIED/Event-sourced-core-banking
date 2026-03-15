import { DomainEvent } from './domain-event';

export abstract class AggregateRoot {
  private uncommittedEvents: DomainEvent[] = [];

  protected apply(event: DomainEvent, isFromHistory = false): void {
    this.when(event);
    if (!isFromHistory) {
      this.uncommittedEvents.push(event);
    }
  }

  loadFromHistory(events: DomainEvent[]): void {
    events.forEach((event) => this.apply(event, true));
  }

  pullUncommittedEvents(): DomainEvent[] {
    const events = [...this.uncommittedEvents];
    this.uncommittedEvents = [];
    return events;
  }

  protected abstract when(event: DomainEvent): void;
}
