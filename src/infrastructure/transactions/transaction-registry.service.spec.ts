import { ConflictException } from '@nestjs/common';
import { TransactionRegistryService } from './transaction-registry.service';
import { TransactionRecordRepository } from './transaction-record.repository';

describe('TransactionRegistryService', () => {
  it('returns accepted when the same transaction was already completed', async () => {
    const repository: TransactionRecordRepository = {
      reserve: jest.fn().mockResolvedValue({
        created: false,
        record: {
          transactionId: 'txn-1',
          accountId: 'acc-1',
          operationType: 'DEPOSIT',
          status: 'COMPLETED',
          amountMinorUnits: '1025',
          amount: 10.25,
          currency: 'USD',
          idempotencyKey: 'key-1',
          errorMessage: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      markPending: jest.fn(),
      markCompleted: jest.fn(),
      markFailed: jest.fn(),
    };

    const service = new TransactionRegistryService(repository);
    const result = await service.execute(
      {
        transactionId: 'txn-1',
        accountId: 'acc-1',
        operationType: 'DEPOSIT',
        amount: '10.25',
        currency: 'USD',
        idempotencyKey: 'key-2',
      },
      async () => ({ status: 'accepted' }),
    );

    expect(result).toEqual({ status: 'accepted' });
  });

  it('rejects reuse of a transaction id for a different money movement', async () => {
    const repository: TransactionRecordRepository = {
      reserve: jest.fn().mockResolvedValue({
        created: false,
        record: {
          transactionId: 'txn-1',
          accountId: 'acc-1',
          operationType: 'DEPOSIT',
          status: 'COMPLETED',
          amountMinorUnits: '1025',
          amount: 10.25,
          currency: 'USD',
          idempotencyKey: 'key-1',
          errorMessage: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      markPending: jest.fn(),
      markCompleted: jest.fn(),
      markFailed: jest.fn(),
    };

    const service = new TransactionRegistryService(repository);

    await expect(
      service.execute(
        {
          transactionId: 'txn-1',
          accountId: 'acc-1',
          operationType: 'DEPOSIT',
          amount: '10.35',
          currency: 'USD',
          idempotencyKey: 'key-2',
        },
        async () => ({ status: 'accepted' }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
