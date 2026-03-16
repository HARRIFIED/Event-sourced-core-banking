import { CommandBus, CommandHandler, ICommandHandler } from '@nestjs/cqrs';
import { randomUUID } from 'crypto';
import { InitiateTransferCommand } from '../commands/initiate-transfer.command';
import { WithdrawMoneyCommand } from '../../../accounts/application/commands/withdraw-money.command';
import { DepositMoneyCommand } from '../../../accounts/application/commands/deposit-money.command';

@CommandHandler(InitiateTransferCommand)
export class InitiateTransferHandler implements ICommandHandler<InitiateTransferCommand, void> {
  constructor(private readonly commandBus: CommandBus) {}

  async execute(command: InitiateTransferCommand): Promise<void> {
    await this.commandBus.execute(
      new WithdrawMoneyCommand(
        command.sourceAccountId,
        command.amount,
        command.currency,
        {
          ...command.context,
          causationId: command.context.commandId,
          commandId: randomUUID(),
        },
        command.transferId,
      ),
    );

    await this.commandBus.execute(
      new DepositMoneyCommand(
        command.destinationAccountId,
        command.amount,
        command.currency,
        {
          ...command.context,
          causationId: command.context.commandId,
          commandId: randomUUID(),
        },
        command.transferId,
      ),
    );
  }
}
