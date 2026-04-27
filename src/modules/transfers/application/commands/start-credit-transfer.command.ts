import { CommandContext } from '../../../../common/cqrs/command-context';

export class StartCreditTransferCommand {
  constructor(
    public readonly transferId: string,
    public readonly transactionId: string,
    public readonly context: CommandContext,
  ) {}
}
