import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { randomUUID } from 'crypto';
import { TransferRepository } from '../../domain/transfer.repository';
import {
  TRANSFER_READ_MODEL_REPOSITORY,
  TransferReadModelRepository,
  TransferSummaryReadModel,
} from '../../query/transfer-read-model.repository';
import { StartDebitTransferCommand } from '../commands/start-debit-transfer.command';
import { MarkTransferDebitedCommand } from '../commands/mark-transfer-debited.command';
import { StartCreditTransferCommand } from '../commands/start-credit-transfer.command';
import { CompleteTransferCommand } from '../commands/complete-transfer.command';
import { FailTransferCommand } from '../commands/fail-transfer.command';
import { StartTransferCompensationCommand } from '../commands/start-transfer-compensation.command';
import { CompleteTransferCompensationCommand } from '../commands/complete-transfer-compensation.command';
import { WithdrawMoneyCommand } from '../../../accounts/application/commands/withdraw-money.command';
import { DepositMoneyCommand } from '../../../accounts/application/commands/deposit-money.command';
import { TransactionRegistryService } from '../../../../infrastructure/transactions/transaction-registry.service';
import { RetryableTransferProcessingError, TransferLogger } from '../handlers/transfer-command.handlers';
import { CommandContext } from '../../../../common/cqrs/command-context';
import { Inject } from '@nestjs/common';
import { minorUnitsToNumber } from '../../../../common/money/money';
import { TransferStatus } from '../../domain/transfer-status.enum';

const POLL_INTERVAL_MS = 200;

@Injectable()
export class TransferCoordinatorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(TransferCoordinatorService.name);
  private isRunning = false;
  private loopPromise: Promise<void> | null = null;

  constructor(
    private readonly commandBus: CommandBus,
    private readonly transferRepository: TransferRepository,
    private readonly transactionRegistry: TransactionRegistryService,
    @Inject(TRANSFER_READ_MODEL_REPOSITORY)
    private readonly transfers: TransferReadModelRepository,
  ) {}

  onModuleInit(): void {
    this.isRunning = true;
    this.loopPromise = this.runLoop();
  }

  async onModuleDestroy(): Promise<void> {
    this.isRunning = false;
    await this.loopPromise;
  }

  async processPendingTransfersOnce(): Promise<void> {
    const pending = await this.transfers.listPendingTransfers(50);
    for (const transfer of pending) {
      await this.processTransfer(transfer);
    }
  }

  private async runLoop(): Promise<void> {
    while (this.isRunning) {
      try {
        await this.processPendingTransfersOnce();
      } catch (error) {
        this.logger.error(`Transfer coordinator loop failed: ${error instanceof Error ? error.message : String(error)}`);
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  private async processTransfer(summary: TransferSummaryReadModel): Promise<void> {
    const transfer = await this.transferRepository.getById(summary.transferId);
    const context = this.makeContext(summary.transferId);
    const logContext = {
      transferId: transfer.transferId,
      sourceAccountId: transfer.sourceAccountId,
      destinationAccountId: transfer.destinationAccountId,
      sourceDebitTransactionId: transfer.sourceDebitTransactionId,
      destinationCreditTransactionId: transfer.destinationCreditTransactionId,
      compensationTransactionId: transfer.compensationTransactionId,
      correlationId: context.correlationId,
      causationId: context.causationId,
    };

    try {
      switch (transfer.status) {
        case TransferStatus.INITIATED:
        case TransferStatus.DEBIT_IN_PROGRESS:
          TransferLogger.logContext(this.logger, 'Processing transfer debit', logContext);
          await this.processDebit(transfer.transferId, context, transfer.sourceDebitTransactionId ?? `${transfer.transferId}:debit`);
          return;
        case TransferStatus.DEBITED:
        case TransferStatus.CREDIT_IN_PROGRESS:
          TransferLogger.logContext(this.logger, 'Processing transfer credit', logContext);
          await this.processCredit(transfer.transferId, context, transfer.destinationCreditTransactionId ?? `${transfer.transferId}:credit`);
          return;
        case TransferStatus.FAILED:
          if (transfer.failureStage === 'CREDIT') {
            TransferLogger.logContext(this.logger, 'Processing transfer compensation', logContext);
            await this.processCompensation(transfer.transferId, context, transfer.compensationTransactionId ?? `${transfer.transferId}:compensation`);
          }
          return;
        case TransferStatus.COMPENSATION_IN_PROGRESS:
          TransferLogger.logContext(this.logger, 'Retrying transfer compensation', logContext);
          await this.processCompensation(transfer.transferId, context, transfer.compensationTransactionId ?? `${transfer.transferId}:compensation`);
          return;
        default:
          return;
      }
    } catch (error) {
      this.logger.error(
        `Transfer ${transfer.transferId} processing failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async processDebit(transferId: string, context: CommandContext, transactionId: string): Promise<void> {
    const transfer = await this.transferRepository.getById(transferId);
    if (transfer.status === TransferStatus.INITIATED || transfer.status === TransferStatus.DEBIT_IN_PROGRESS) {
      await this.commandBus.execute(new StartDebitTransferCommand(transferId, transactionId, context));
    }

    try {
      await this.transactionRegistry.execute(
        {
          transactionId,
          accountId: transfer.sourceAccountId,
          operationType: 'WITHDRAW',
          amount: transfer.amountMinorUnits.toString(),
          currency: transfer.currency,
          idempotencyKey: transfer.transferId,
        },
        async () => {
          await this.commandBus.execute(
            new WithdrawMoneyCommand(
              transfer.sourceAccountId,
              minorUnitsToNumber(transfer.amountMinorUnits),
              transfer.currency,
              context,
              transactionId,
            ),
          );
          return { status: 'accepted' };
        },
        {
          retryFailed: true,
          isRetryableError: (error) => error instanceof RetryableTransferProcessingError,
        },
      );
      await this.commandBus.execute(new MarkTransferDebitedCommand(transferId, context));
    } catch (error) {
      if (this.isTerminalDomainError(error)) {
        await this.commandBus.execute(
          new FailTransferCommand(
            transferId,
            error instanceof Error ? error.message : String(error),
            'DEBIT',
            context,
          ),
        );
        return;
      }

      throw new RetryableTransferProcessingError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async processCredit(transferId: string, context: CommandContext, transactionId: string): Promise<void> {
    const transfer = await this.transferRepository.getById(transferId);
    if (transfer.status === TransferStatus.DEBITED || transfer.status === TransferStatus.CREDIT_IN_PROGRESS) {
      await this.commandBus.execute(new StartCreditTransferCommand(transferId, transactionId, context));
    }

    try {
      await this.transactionRegistry.execute(
        {
          transactionId,
          accountId: transfer.destinationAccountId,
          operationType: 'DEPOSIT',
          amount: transfer.amountMinorUnits.toString(),
          currency: transfer.currency,
          idempotencyKey: transfer.transferId,
        },
        async () => {
          await this.commandBus.execute(
            new DepositMoneyCommand(
              transfer.destinationAccountId,
              minorUnitsToNumber(transfer.amountMinorUnits),
              transfer.currency,
              context,
              transactionId,
            ),
          );
          return { status: 'accepted' };
        },
        {
          retryFailed: true,
          isRetryableError: (error) => error instanceof RetryableTransferProcessingError,
        },
      );
      await this.commandBus.execute(new CompleteTransferCommand(transferId, context));
    } catch (error) {
      if (this.isTerminalDomainError(error)) {
        await this.commandBus.execute(
          new FailTransferCommand(
            transferId,
            error instanceof Error ? error.message : String(error),
            'CREDIT',
            context,
          ),
        );
        return;
      }

      throw new RetryableTransferProcessingError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async processCompensation(transferId: string, context: CommandContext, transactionId: string): Promise<void> {
    const transfer = await this.transferRepository.getById(transferId);
    if (transfer.status === TransferStatus.FAILED || transfer.status === TransferStatus.COMPENSATION_IN_PROGRESS) {
      await this.commandBus.execute(new StartTransferCompensationCommand(transferId, transactionId, context));
    }

    try {
      await this.transactionRegistry.execute(
        {
          transactionId,
          accountId: transfer.sourceAccountId,
          operationType: 'DEPOSIT',
          amount: transfer.amountMinorUnits.toString(),
          currency: transfer.currency,
          idempotencyKey: transfer.transferId,
        },
        async () => {
          await this.commandBus.execute(
            new DepositMoneyCommand(
              transfer.sourceAccountId,
              minorUnitsToNumber(transfer.amountMinorUnits),
              transfer.currency,
              context,
              transactionId,
            ),
          );
          return { status: 'accepted' };
        },
        {
          retryFailed: true,
          isRetryableError: (error) => error instanceof RetryableTransferProcessingError,
        },
      );
      await this.commandBus.execute(new CompleteTransferCompensationCommand(transferId, context));
    } catch (error) {
      throw new RetryableTransferProcessingError(
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private isTerminalDomainError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    return [
      'Insufficient funds',
      'Account is not active',
      'Currency mismatch',
      'not found',
    ].some((message) => error.message.includes(message));
  }

  private makeContext(transferId: string): CommandContext {
    return {
      commandId: randomUUID(),
      correlationId: transferId,
      causationId: `transfer-coordinator:${transferId}`,
      actor: 'transfer-coordinator',
    };
  }
}
