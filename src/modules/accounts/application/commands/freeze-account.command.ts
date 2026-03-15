import { CommandContext } from '../../../../common/cqrs/command-context';

export class FreezeAccountCommand {
  constructor(
    public readonly accountId: string,
    public readonly reason: string,
    public readonly context: CommandContext,
  ) {}
}
