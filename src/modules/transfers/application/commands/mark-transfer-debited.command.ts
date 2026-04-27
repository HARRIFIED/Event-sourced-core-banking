import { CommandContext } from '../../../../common/cqrs/command-context';

export class MarkTransferDebitedCommand {
  constructor(
    public readonly transferId: string,
    public readonly context: CommandContext,
  ) {}
}
