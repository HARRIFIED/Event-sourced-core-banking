import { TransferAggregate } from './transfer.aggregate';

const context = {
  commandId: 'cmd-1',
  correlationId: 'corr-1',
  actor: 'tester',
};

describe('TransferAggregate', () => {
  it('rejects transfers to the same account', () => {
    const transfer = new TransferAggregate();

    expect(() =>
      transfer.initiate('trf-1', 'acc-1', 'acc-1', 100, 'NGN', context),
    ).toThrow('Source and destination accounts must be different');
  });

  it('rejects non-positive amounts', () => {
    const transfer = new TransferAggregate();

    expect(() =>
      transfer.initiate('trf-1', 'acc-1', 'acc-2', 0, 'NGN', context),
    ).toThrow('Transfer amount must be positive');
  });

  it('rejects out-of-order transitions', () => {
    const transfer = new TransferAggregate();
    transfer.initiate('trf-1', 'acc-1', 'acc-2', 100, 'NGN', context);

    expect(() => transfer.complete(context)).toThrow('Cannot complete transfer from status INITIATED');
  });

  it('rejects compensation before a debited credit failure path exists', () => {
    const transfer = new TransferAggregate();
    transfer.initiate('trf-1', 'acc-1', 'acc-2', 100, 'NGN', context);
    transfer.startDebit('trf-1:debit', context);
    transfer.fail('Insufficient funds', 'DEBIT', context);

    expect(() => transfer.startCompensation('trf-1:comp', context)).toThrow(
      'Compensation is only allowed after a debited transfer fails during credit',
    );
  });
});
