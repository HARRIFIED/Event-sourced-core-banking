import { CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { CreateAccountCommand } from '../commands/create-account.command';
import { DepositMoneyCommand } from '../commands/deposit-money.command';
import { WithdrawMoneyCommand } from '../commands/withdraw-money.command';
import { FreezeAccountCommand } from '../commands/freeze-account.command';
import { AccountRepository } from '../../domain/account.repository';

@CommandHandler(CreateAccountCommand)
export class CreateAccountHandler implements ICommandHandler<CreateAccountCommand, void> {
  constructor(private readonly repository: AccountRepository) {}

  async execute(command: CreateAccountCommand): Promise<void> {
    await this.repository.executeWithRetry(command.accountId, (account) => {
      account.create(command.accountId, command.ownerId, command.currency, command.context);
    });
  }
}

@CommandHandler(DepositMoneyCommand)
export class DepositMoneyHandler implements ICommandHandler<DepositMoneyCommand, void> {
  constructor(private readonly repository: AccountRepository) {}

  async execute(command: DepositMoneyCommand): Promise<void> {
    await this.repository.executeWithRetry(command.accountId, (account) => {
      account.deposit(command.amount, command.currency, command.transactionId, command.context);
    });
  }
}

@CommandHandler(WithdrawMoneyCommand)
export class WithdrawMoneyHandler implements ICommandHandler<WithdrawMoneyCommand, void> {
  constructor(private readonly repository: AccountRepository) {}

  async execute(command: WithdrawMoneyCommand): Promise<void> {
    await this.repository.executeWithRetry(command.accountId, (account) => {
      account.withdraw(command.amount, command.currency, command.transactionId, command.context);
    });
  }
}

@CommandHandler(FreezeAccountCommand)
export class FreezeAccountHandler implements ICommandHandler<FreezeAccountCommand, void> {
  constructor(private readonly repository: AccountRepository) {}

  async execute(command: FreezeAccountCommand): Promise<void> {
    await this.repository.executeWithRetry(command.accountId, (account) => {
      account.freeze(command.reason, command.context);
    });
  }
}

export const AccountCommandHandlers = [
  CreateAccountHandler,
  DepositMoneyHandler,
  WithdrawMoneyHandler,
  FreezeAccountHandler,
];
