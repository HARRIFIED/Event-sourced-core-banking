import { ConflictException } from '@nestjs/common';
import { createHash } from 'crypto';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyRecordRepository } from './idempotency-record.repository';

function requestHash(operation: string, payload: object): string {
  return createHash('sha256')
    .update(JSON.stringify({ operation, payload }))
    .digest('hex');
}

describe('IdempotencyService', () => {
  it('returns cached response for completed duplicate requests', async () => {
    const payload = { amount: '10.25' };
    const repository: IdempotencyRecordRepository = {
      reserve: jest.fn()
        .mockResolvedValueOnce({ created: true, record: null })
        .mockResolvedValueOnce({
          created: false,
          record: {
            idempotencyKey: 'key-1',
            operation: 'accounts.deposit',
            requestHash: requestHash('accounts.deposit', payload),
            status: 'COMPLETED',
            responsePayload: { status: 'accepted' },
            errorMessage: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        }),
      markCompleted: jest.fn(),
      markFailed: jest.fn(),
    };

    const service = new IdempotencyService(repository);
    await service.execute('key-1', 'accounts.deposit', payload, async () => ({ status: 'accepted' }));
    const duplicate = await service.execute('key-1', 'accounts.deposit', payload, async () => ({ status: 'accepted' }));

    expect(duplicate).toEqual({ status: 'accepted' });
  });

  it('rejects reuse of the same key for a different request', async () => {
    const repository: IdempotencyRecordRepository = {
      reserve: jest.fn().mockResolvedValue({
        created: false,
        record: {
          idempotencyKey: 'key-1',
          operation: 'accounts.deposit',
          requestHash: 'old-hash',
          status: 'COMPLETED',
          responsePayload: { status: 'accepted' },
          errorMessage: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      }),
      markCompleted: jest.fn(),
      markFailed: jest.fn(),
    };

    const service = new IdempotencyService(repository);

    await expect(
      service.execute('key-1', 'accounts.withdraw', { amount: '10.25' }, async () => ({ status: 'accepted' })),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
