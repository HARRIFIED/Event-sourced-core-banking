import { CommandContext } from '../../../../common/cqrs/command-context';

export class CreateAccountCommand {
  constructor(
    public readonly accountId: string,
    public readonly ownerId: string,
    public readonly currency: string,
    public readonly context: CommandContext,
  ) {}
}
