import { BadRequestException, Logger } from '@nestjs/common';
import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { InitiateTransferCommand } from '../commands/initiate-transfer.command';
import { TransferRepository } from '../../domain/transfer.repository';
import { StartDebitTransferCommand } from '../commands/start-debit-transfer.command';
import { MarkTransferDebitedCommand } from '../commands/mark-transfer-debited.command';
import { StartCreditTransferCommand } from '../commands/start-credit-transfer.command';
import { CompleteTransferCommand } from '../commands/complete-transfer.command';
import { FailTransferCommand } from '../commands/fail-transfer.command';
import { StartTransferCompensationCommand } from '../commands/start-transfer-compensation.command';
import { CompleteTransferCompensationCommand } from '../commands/complete-transfer-compensation.command';
import { AccountRepository } from '../../../accounts/domain/account.repository';

@CommandHandler(InitiateTransferCommand)
export class InitiateTransferHandler implements ICommandHandler<InitiateTransferCommand, void> {
  constructor(
    private readonly repository: TransferRepository,
    private readonly accountRepository: AccountRepository,
  ) {}

  async execute(command: InitiateTransferCommand): Promise<void> {
    const source = await this.accountRepository.getById(command.sourceAccountId);
    const destination = await this.accountRepository.getById(command.destinationAccountId);

    if (!source.accountId) {
      throw new BadRequestException(`Source account ${command.sourceAccountId} not found`);
    }
    if (!destination.accountId) {
      throw new BadRequestException(`Destination account ${command.destinationAccountId} not found`);
    }
    if (source.currency !== command.currency || destination.currency !== command.currency) {
      throw new BadRequestException('Transfer currency must match both accounts');
    }

    await this.repository.executeWithRetry(command.transferId, (transfer) => {
      transfer.initiate(
        command.transferId,
        command.sourceAccountId,
        command.destinationAccountId,
        command.amount,
        command.currency,
        command.context,
      );
    });
  }
}

@CommandHandler(StartDebitTransferCommand)
export class StartDebitTransferHandler implements ICommandHandler<StartDebitTransferCommand, void> {
  constructor(private readonly repository: TransferRepository) {}

  async execute(command: StartDebitTransferCommand): Promise<void> {
    await this.repository.executeWithRetry(command.transferId, (transfer) => {
      transfer.startDebit(command.transactionId, command.context);
    });
  }
}

@CommandHandler(MarkTransferDebitedCommand)
export class MarkTransferDebitedHandler implements ICommandHandler<MarkTransferDebitedCommand, void> {
  constructor(private readonly repository: TransferRepository) {}

  async execute(command: MarkTransferDebitedCommand): Promise<void> {
    await this.repository.executeWithRetry(command.transferId, (transfer) => {
      transfer.markDebited(command.context);
    });
  }
}

@CommandHandler(StartCreditTransferCommand)
export class StartCreditTransferHandler implements ICommandHandler<StartCreditTransferCommand, void> {
  constructor(private readonly repository: TransferRepository) {}

  async execute(command: StartCreditTransferCommand): Promise<void> {
    await this.repository.executeWithRetry(command.transferId, (transfer) => {
      transfer.startCredit(command.transactionId, command.context);
    });
  }
}

@CommandHandler(CompleteTransferCommand)
export class CompleteTransferHandler implements ICommandHandler<CompleteTransferCommand, void> {
  constructor(private readonly repository: TransferRepository) {}

  async execute(command: CompleteTransferCommand): Promise<void> {
    await this.repository.executeWithRetry(command.transferId, (transfer) => {
      transfer.complete(command.context);
    });
  }
}

@CommandHandler(FailTransferCommand)
export class FailTransferHandler implements ICommandHandler<FailTransferCommand, void> {
  constructor(private readonly repository: TransferRepository) {}

  async execute(command: FailTransferCommand): Promise<void> {
    await this.repository.executeWithRetry(command.transferId, (transfer) => {
      transfer.fail(command.reason, command.stage, command.context);
    });
  }
}

@CommandHandler(StartTransferCompensationCommand)
export class StartTransferCompensationHandler implements ICommandHandler<StartTransferCompensationCommand, void> {
  constructor(private readonly repository: TransferRepository) {}

  async execute(command: StartTransferCompensationCommand): Promise<void> {
    await this.repository.executeWithRetry(command.transferId, (transfer) => {
      transfer.startCompensation(command.transactionId, command.context);
    });
  }
}

@CommandHandler(CompleteTransferCompensationCommand)
export class CompleteTransferCompensationHandler implements ICommandHandler<CompleteTransferCompensationCommand, void> {
  constructor(private readonly repository: TransferRepository) {}

  async execute(command: CompleteTransferCompensationCommand): Promise<void> {
    await this.repository.executeWithRetry(command.transferId, (transfer) => {
      transfer.markCompensated(command.context);
    });
  }
}

export const TransferCommandHandlers = [
  InitiateTransferHandler,
  StartDebitTransferHandler,
  MarkTransferDebitedHandler,
  StartCreditTransferHandler,
  CompleteTransferHandler,
  FailTransferHandler,
  StartTransferCompensationHandler,
  CompleteTransferCompensationHandler,
];

export class RetryableTransferProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RetryableTransferProcessingError';
  }
}

export class TransferLogger {
  static logContext(
    logger: Logger,
    message: string,
    context: Record<string, unknown>,
  ): void {
    logger.log(`${message} ${JSON.stringify(context)}`);
  }
}
