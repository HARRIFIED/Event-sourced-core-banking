import { DomainEvent } from './domain-event';

export abstract class AggregateRoot {
  // Events raised during the current command execution but not yet persisted.
  private uncommittedEvents: DomainEvent[] = [];

  /**
   * Two things happen here:
    this.when(event) changes the aggregate’s state
    if isFromHistory = true, the event is not added to uncommittedEvents
   * @param event 
   * @param isFromHistory 
   */
  protected apply(event: DomainEvent, isFromHistory = false): void {
    this.when(event);
    
    if (!isFromHistory) {
      this.uncommittedEvents.push(event);
    }
  }

  /**
   * loop through every stored event apply each one to the aggregate pass true for isFromHistory
     That true is important: these are old events we are replaying, not brand new ones we want to save again.
   * @param events 
   */
  loadFromHistory(events: DomainEvent[]): void {
    events.forEach((event) => this.apply(event, true));
  }

  pullUncommittedEvents(): DomainEvent[] {
    // Repository calls this before append so the aggregate can hand over only
    // the new events produced by the current command.
    const events = [...this.uncommittedEvents];
    this.uncommittedEvents = [];
    return events;
  }

  protected abstract when(event: DomainEvent): void;
}
