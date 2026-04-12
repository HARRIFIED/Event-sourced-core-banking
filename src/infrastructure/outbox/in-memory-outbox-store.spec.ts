import { InMemoryOutboxStore } from './in-memory-outbox-store';

describe('InMemoryOutboxStore', () => {
  it('claims pending messages in event position order before createdAt order', async () => {
    const store = new InMemoryOutboxStore();

    await store.stage([
      {
        id: 'msg-early-created',
        topic: 'account-events',
        messageKey: 'account-1',
        payload: { streamVersion: 10 },
        createdAt: '2026-04-12T10:00:00.000Z',
        eventPosition: 10,
        attempts: 0,
      },
      {
        id: 'msg-late-created',
        topic: 'account-events',
        messageKey: 'account-1',
        payload: { streamVersion: 9 },
        createdAt: '2026-04-12T10:00:01.000Z',
        eventPosition: 9,
        attempts: 0,
      },
    ]);

    const claimed = await store.claimPending(10);

    expect(claimed.map((message) => message.id)).toEqual([
      'msg-late-created',
      'msg-early-created',
    ]);
  });
});
