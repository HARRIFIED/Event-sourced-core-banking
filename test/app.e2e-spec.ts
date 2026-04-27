import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AccountRepository } from '../src/modules/accounts/domain/account.repository';
import { ProjectionRunnerService } from '../src/infrastructure/projections/projection-runner.service';
import { TransferCoordinatorService } from '../src/modules/transfers/application/services/transfer-coordinator.service';
import { randomUUID } from 'crypto';

describe('Health (e2e)', () => {
  let app: INestApplication;
  let accountRepository: AccountRepository;
  let projectionRunner: ProjectionRunnerService;
  let transferCoordinator: TransferCoordinatorService;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();
    accountRepository = app.get(AccountRepository);
    projectionRunner = app.get(ProjectionRunnerService);
    transferCoordinator = app.get(TransferCoordinatorService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('/api/health (GET)', async () => {
    const res = await request(app.getHttpServer()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('POST /api/transfers accepts a transfer and GET /api/transfers/:id returns status', async () => {
    const sourceId = `acc-source-${Date.now()}`;
    const destinationId = `acc-dest-${Date.now()}`;
    const transferId = `trf-${Date.now()}`;
    const ctx = () => ({ commandId: randomUUID(), correlationId: randomUUID() });

    await accountRepository.executeWithRetry(sourceId, (account) => {
      account.create(sourceId, 'owner-1', 'NGN', ctx());
    });
    await accountRepository.executeWithRetry(sourceId, (account) => {
      account.deposit(1000, 'NGN', `seed-${sourceId}`, ctx());
    });
    await accountRepository.executeWithRetry(destinationId, (account) => {
      account.create(destinationId, 'owner-2', 'NGN', ctx());
    });

    await new Promise((resolve) => setTimeout(resolve, 100));
    await projectionRunner.replayFrom(0);

    const createResponse = await request(app.getHttpServer())
      .post('/api/transfers')
      .set('Idempotency-Key', `idem-${transferId}`)
      .send({
        transferId,
        sourceAccountId: sourceId,
        destinationAccountId: destinationId,
        amount: 150,
        currency: 'NGN',
      });

    expect(createResponse.status).toBe(202);
    expect(createResponse.body.transferId).toBe(transferId);
    expect(createResponse.body.status).toBe('accepted');

    await projectionRunner.replayFrom(0);
    await transferCoordinator.processPendingTransfersOnce();
    await projectionRunner.replayFrom(0);
    await transferCoordinator.processPendingTransfersOnce();
    await projectionRunner.replayFrom(0);

    const statusResponse = await request(app.getHttpServer()).get(`/api/transfers/${transferId}`);
    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.transferId).toBe(transferId);
    expect(['INITIATED', 'DEBIT_IN_PROGRESS', 'DEBITED', 'CREDIT_IN_PROGRESS', 'COMPLETED']).toContain(
      statusResponse.body.status,
    );
  });
});
