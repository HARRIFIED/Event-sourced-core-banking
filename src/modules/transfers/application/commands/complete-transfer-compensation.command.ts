import { CommandContext } from '../../../../common/cqrs/command-context';

export class CompleteTransferCompensationCommand {
  constructor(
    public readonly transferId: string,
    public readonly context: CommandContext,
  ) {}
}
