import { CommandContext } from '../../../../common/cqrs/command-context';

export class InitiateTransferCommand {
  constructor(
    public readonly transferId: string,
    public readonly sourceAccountId: string,
    public readonly destinationAccountId: string,
    public readonly amount: number,
    public readonly currency: string,
    public readonly context: CommandContext,
  ) {}
}
