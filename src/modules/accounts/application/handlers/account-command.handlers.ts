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
    const account = await this.repository.getById(command.accountId);
    account.create(command.accountId, command.ownerId, command.currency, command.context);
    await this.repository.save(command.accountId, account);
  }
}

@CommandHandler(DepositMoneyCommand)
export class DepositMoneyHandler implements ICommandHandler<DepositMoneyCommand, void> {
  constructor(private readonly repository: AccountRepository) {}

  async execute(command: DepositMoneyCommand): Promise<void> {
    const account = await this.repository.getById(command.accountId);
    account.deposit(
      command.amount,
      command.currency,
      command.transactionId,
      command.context,
    );
    await this.repository.save(command.accountId, account);
  }
}

@CommandHandler(WithdrawMoneyCommand)
export class WithdrawMoneyHandler implements ICommandHandler<WithdrawMoneyCommand, void> {
  constructor(private readonly repository: AccountRepository) {}

  async execute(command: WithdrawMoneyCommand): Promise<void> {
    const account = await this.repository.getById(command.accountId);
    account.withdraw(
      command.amount,
      command.currency,
      command.transactionId,
      command.context,
    );
    await this.repository.save(command.accountId, account);
  }
}

@CommandHandler(FreezeAccountCommand)
export class FreezeAccountHandler implements ICommandHandler<FreezeAccountCommand, void> {
  constructor(private readonly repository: AccountRepository) {}

  async execute(command: FreezeAccountCommand): Promise<void> {
    const account = await this.repository.getById(command.accountId);
    account.freeze(command.reason, command.context);
    await this.repository.save(command.accountId, account);
  }
}

export const AccountCommandHandlers = [
  CreateAccountHandler,
  DepositMoneyHandler,
  WithdrawMoneyHandler,
  FreezeAccountHandler,
];
