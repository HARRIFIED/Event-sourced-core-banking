import { AccountAggregate } from './account.aggregate';

const context = {
  commandId: 'cmd-1',
  correlationId: 'corr-1',
  actor: 'tester',
};

describe('AccountAggregate', () => {
  it('handles decimal deposits and withdrawals using minor units internally', () => {
    const account = new AccountAggregate();

    account.create('acc-1', 'owner-1', 'USD', context);
    account.deposit('10.25', 'USD', 'txn-1', context);
    account.withdraw('0.30', 'USD', 'txn-2', context);

    expect(account.balanceMinorUnits).toBe(995n);
    expect(account.balance).toBe(9.95);
  });

  it('stores decimal amounts in emitted events as fixed-point strings', () => {
    const account = new AccountAggregate();

    account.create('acc-1', 'owner-1', 'USD', context);
    account.deposit('10.25', 'USD', 'txn-1', context);

    const events = account.pullUncommittedEvents();
    expect(events[1].data.amount).toBe('10.25');
  });
});
