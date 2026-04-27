import { CommandContext } from '../../../../common/cqrs/command-context';

export class CompleteTransferCommand {
  constructor(
    public readonly transferId: string,
    public readonly context: CommandContext,
  ) {}
}
