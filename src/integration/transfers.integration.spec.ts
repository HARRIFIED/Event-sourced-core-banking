import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { AccountRepository } from '../modules/accounts/domain/account.repository';
import { InMemoryEventStore } from '../infrastructure/event-store/in-memory-event-store';
import { InMemoryOutboxStore } from '../infrastructure/outbox/in-memory-outbox-store';
import { InMemorySnapshotStore } from '../infrastructure/snapshots/in-memory-snapshot-store';
import { TransferRepository } from '../modules/transfers/domain/transfer.repository';
import { InMemoryAccountReadModelRepository } from '../modules/accounts/query/in-memory-account-read-model.repository';
import { InMemoryTransferReadModelRepository } from '../modules/transfers/query/in-memory-transfer-read-model.repository';
import { AccountProjector } from '../modules/accounts/query/account-projector.service';
import { TransferProjector } from '../modules/transfers/query/transfer-projector.service';
import { ProjectionRunnerService } from '../infrastructure/projections/projection-runner.service';
import {
  CompleteTransferCompensationHandler,
  CompleteTransferHandler,
  FailTransferHandler,
  InitiateTransferHandler,
  MarkTransferDebitedHandler,
  StartCreditTransferHandler,
  StartDebitTransferHandler,
  StartTransferCompensationHandler,
} from '../modules/transfers/application/handlers/transfer-command.handlers';
import { TransactionRegistryService } from '../infrastructure/transactions/transaction-registry.service';
import { InMemoryTransactionRecordRepository } from '../infrastructure/transactions/in-memory-transaction-record.repository';
import { TransferCoordinatorService } from '../modules/transfers/application/services/transfer-coordinator.service';
import { InitiateTransferCommand } from '../modules/transfers/application/commands/initiate-transfer.command';
import { StartDebitTransferCommand } from '../modules/transfers/application/commands/start-debit-transfer.command';
import { MarkTransferDebitedCommand } from '../modules/transfers/application/commands/mark-transfer-debited.command';
import { StartCreditTransferCommand } from '../modules/transfers/application/commands/start-credit-transfer.command';
import { CompleteTransferCommand } from '../modules/transfers/application/commands/complete-transfer.command';
import { FailTransferCommand } from '../modules/transfers/application/commands/fail-transfer.command';
import { StartTransferCompensationCommand } from '../modules/transfers/application/commands/start-transfer-compensation.command';
import { CompleteTransferCompensationCommand } from '../modules/transfers/application/commands/complete-transfer-compensation.command';
import { WithdrawMoneyCommand } from '../modules/accounts/application/commands/withdraw-money.command';
import { DepositMoneyCommand } from '../modules/accounts/application/commands/deposit-money.command';

function ctx() {
  return { commandId: randomUUID(), correlationId: randomUUID() };
}

function buildStack() {
  const outboxStore = new InMemoryOutboxStore();
  const eventStore = new InMemoryEventStore(outboxStore);
  const snapshotStore = new InMemorySnapshotStore();
  const accountRepository = new AccountRepository(eventStore, snapshotStore);
  const transferRepository = new TransferRepository(eventStore);
  const accountReadModels = new InMemoryAccountReadModelRepository();
  const transferReadModels = new InMemoryTransferReadModelRepository();
  const accountProjector = new AccountProjector(accountReadModels, transferReadModels);
  const transferProjector = new TransferProjector(transferReadModels);
  const projectionRunner = new ProjectionRunnerService(
    new ConfigService({ EVENT_STORE_KIND: 'in-memory' }),
    eventStore,
    accountReadModels,
    transferReadModels,
    accountProjector,
    transferProjector,
  );
  const transactionRegistry = new TransactionRegistryService(
    new InMemoryTransactionRecordRepository(),
  );

  const handlers = {
    initiate: new InitiateTransferHandler(transferRepository, accountRepository),
    startDebit: new StartDebitTransferHandler(transferRepository),
    markDebited: new MarkTransferDebitedHandler(transferRepository),
    startCredit: new StartCreditTransferHandler(transferRepository),
    complete: new CompleteTransferHandler(transferRepository),
    fail: new FailTransferHandler(transferRepository),
    startCompensation: new StartTransferCompensationHandler(transferRepository),
    completeCompensation: new CompleteTransferCompensationHandler(transferRepository),
  };

  const commandBus = {
    execute: async (command: unknown) => {
      if (command instanceof InitiateTransferCommand) return handlers.initiate.execute(command);
      if (command instanceof StartDebitTransferCommand) return handlers.startDebit.execute(command);
      if (command instanceof MarkTransferDebitedCommand) return handlers.markDebited.execute(command);
      if (command instanceof StartCreditTransferCommand) return handlers.startCredit.execute(command);
      if (command instanceof CompleteTransferCommand) return handlers.complete.execute(command);
      if (command instanceof FailTransferCommand) return handlers.fail.execute(command);
      if (command instanceof StartTransferCompensationCommand) return handlers.startCompensation.execute(command);
      if (command instanceof CompleteTransferCompensationCommand) return handlers.completeCompensation.execute(command);
      if (command instanceof WithdrawMoneyCommand) {
        return accountRepository.executeWithRetry(command.accountId, (account) => {
          account.withdraw(command.amount, command.currency, command.transactionId, command.context);
        });
      }
      if (command instanceof DepositMoneyCommand) {
        return accountRepository.executeWithRetry(command.accountId, (account) => {
          account.deposit(command.amount, command.currency, command.transactionId, command.context);
        });
      }

      throw new Error(`Unhandled command ${command?.constructor?.name ?? 'UnknownCommand'}`);
    },
  };

  const coordinator = new TransferCoordinatorService(
    commandBus as never,
    transferRepository,
    transactionRegistry,
    transferReadModels,
  );

  return {
    accountRepository,
    transferRepository,
    accountReadModels,
    projectionRunner,
    coordinator,
    transferReadModels,
    commandBus,
  };
}

describe('Transfers integration', () => {
  it('completes a happy-path transfer', async () => {
    const { accountRepository, transferRepository, projectionRunner, coordinator, commandBus, accountReadModels } = buildStack();

    await accountRepository.executeWithRetry('acc-source', (account) => {
      account.create('acc-source', 'owner-1', 'NGN', ctx());
    });
    await accountRepository.executeWithRetry('acc-source', (account) => {
      account.deposit(1000, 'NGN', 'seed-source', ctx());
    });
    await accountRepository.executeWithRetry('acc-dest', (account) => {
      account.create('acc-dest', 'owner-2', 'NGN', ctx());
    });

    await projectionRunner.replayFrom(0);
    await commandBus.execute(
      new InitiateTransferCommand('trf-happy', 'acc-source', 'acc-dest', 250, 'NGN', ctx()),
    );
    await projectionRunner.replayFrom(0);
    await coordinator.processPendingTransfersOnce();
    await projectionRunner.replayFrom(0);
    await coordinator.processPendingTransfersOnce();
    await projectionRunner.replayFrom(0);

    const transfer = await transferRepository.getById('trf-happy');
    const source = await accountRepository.getById('acc-source');
    const destination = await accountRepository.getById('acc-dest');

    expect(transfer.status).toBe('COMPLETED');
    expect(source.balance).toBe(750);
    expect(destination.balance).toBe(250);

    const sourceHistory = await accountReadModels.getAccountStatement('acc-source');
    const destinationHistory = await accountReadModels.getAccountStatement('acc-dest');
    const sourceTransferEntry = sourceHistory.find((entry) => entry.transferId === 'trf-happy');
    const destinationTransferEntry = destinationHistory.find((entry) => entry.transferId === 'trf-happy');

    expect(sourceTransferEntry).toMatchObject({
      entryKind: 'TRANSFER',
      transferDirection: 'OUTGOING',
      sourceAccountId: 'acc-source',
      destinationAccountId: 'acc-dest',
      counterpartyAccountId: 'acc-dest',
      description: 'Transfer sent to account acc-dest',
    });
    expect(destinationTransferEntry).toMatchObject({
      entryKind: 'TRANSFER',
      transferDirection: 'INCOMING',
      sourceAccountId: 'acc-source',
      destinationAccountId: 'acc-dest',
      counterpartyAccountId: 'acc-source',
      description: 'Transfer received from account acc-source',
    });
  });

  it('fails before debit when funds are insufficient', async () => {
    const { accountRepository, transferRepository, projectionRunner, coordinator, commandBus } = buildStack();

    await accountRepository.executeWithRetry('acc-source', (account) => {
      account.create('acc-source', 'owner-1', 'NGN', ctx());
    });
    await accountRepository.executeWithRetry('acc-dest', (account) => {
      account.create('acc-dest', 'owner-2', 'NGN', ctx());
    });

    await projectionRunner.replayFrom(0);
    await commandBus.execute(
      new InitiateTransferCommand('trf-insufficient', 'acc-source', 'acc-dest', 250, 'NGN', ctx()),
    );
    await projectionRunner.replayFrom(0);
    await coordinator.processPendingTransfersOnce();
    await projectionRunner.replayFrom(0);

    const transfer = await transferRepository.getById('trf-insufficient');
    const source = await accountRepository.getById('acc-source');
    const destination = await accountRepository.getById('acc-dest');

    expect(transfer.status).toBe('FAILED');
    expect(transfer.failureStage).toBe('DEBIT');
    expect(source.balance).toBe(0);
    expect(destination.balance).toBe(0);
  });

  it('compensates the source account when credit fails after debit', async () => {
    const { accountRepository, transferRepository, projectionRunner, coordinator, commandBus, transferReadModels } = buildStack();

    await accountRepository.executeWithRetry('acc-source', (account) => {
      account.create('acc-source', 'owner-1', 'NGN', ctx());
    });
    await accountRepository.executeWithRetry('acc-source', (account) => {
      account.deposit(1000, 'NGN', 'seed-source', ctx());
    });
    await accountRepository.executeWithRetry('acc-dest', (account) => {
      account.create('acc-dest', 'owner-2', 'NGN', ctx());
    });
    await accountRepository.executeWithRetry('acc-dest', (account) => {
      account.freeze('manual test freeze', ctx());
    });

    await projectionRunner.replayFrom(0);
    await commandBus.execute(
      new InitiateTransferCommand('trf-compensate', 'acc-source', 'acc-dest', 250, 'NGN', ctx()),
    );
    await projectionRunner.replayFrom(0);
    await coordinator.processPendingTransfersOnce();
    await projectionRunner.replayFrom(0);
    await coordinator.processPendingTransfersOnce();
    await projectionRunner.replayFrom(0);
    await coordinator.processPendingTransfersOnce();
    await projectionRunner.replayFrom(0);

    const transfer = await transferRepository.getById('trf-compensate');
    const summary = await transferReadModels.getTransferSummary('trf-compensate');
    const source = await accountRepository.getById('acc-source');
    const destination = await accountRepository.getById('acc-dest');

    expect(transfer.status).toBe('COMPENSATED');
    expect(summary?.status).toBe('COMPENSATED');
    expect(source.balance).toBe(1000);
    expect(destination.balance).toBe(0);
  });
});
