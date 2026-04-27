import { CommandContext } from '../../../../common/cqrs/command-context';

export class FailTransferCommand {
  constructor(
    public readonly transferId: string,
    public readonly reason: string,
    public readonly stage: 'DEBIT' | 'CREDIT',
    public readonly context: CommandContext,
  ) {}
}
