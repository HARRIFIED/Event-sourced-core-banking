import { CommandContext } from '../../../../common/cqrs/command-context';

export class DepositMoneyCommand {
  constructor(
    public readonly accountId: string,
    public readonly amount: number,
    public readonly currency: string,
    public readonly context: CommandContext,
    public readonly transactionId: string,
  ) {}
}
