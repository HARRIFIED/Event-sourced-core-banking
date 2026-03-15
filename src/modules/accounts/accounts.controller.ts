import { Body, Controller, Param, Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { randomUUID } from 'crypto';
import {
  CreateAccountDto,
  DepositMoneyDto,
  FreezeAccountDto,
  WithdrawMoneyDto,
} from './application/dto/account-commands.dto';
import { CreateAccountCommand } from './application/commands/create-account.command';
import { DepositMoneyCommand } from './application/commands/deposit-money.command';
import { WithdrawMoneyCommand } from './application/commands/withdraw-money.command';
import { FreezeAccountCommand } from './application/commands/freeze-account.command';

@Controller('accounts')
export class AccountsController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post()
  async createAccount(@Body() dto: CreateAccountDto): Promise<{ status: string }> {
    await this.commandBus.execute(
      new CreateAccountCommand(dto.accountId, dto.ownerId, dto.currency, {
        commandId: randomUUID(),
        correlationId: randomUUID(),
        actor: dto.actor,
      }),
    );

    return { status: 'accepted' };
  }

  @Post(':accountId/deposits')
  async deposit(
    @Param('accountId') accountId: string,
    @Body() dto: DepositMoneyDto,
  ): Promise<{ status: string }> {
    await this.commandBus.execute(
      new DepositMoneyCommand(accountId, dto.amount, dto.currency, {
        commandId: randomUUID(),
        correlationId: randomUUID(),
        actor: dto.actor,
      }, dto.transactionId),
    );

    return { status: 'accepted' };
  }

  @Post(':accountId/withdrawals')
  async withdraw(
    @Param('accountId') accountId: string,
    @Body() dto: WithdrawMoneyDto,
  ): Promise<{ status: string }> {
    await this.commandBus.execute(
      new WithdrawMoneyCommand(accountId, dto.amount, dto.currency, {
        commandId: randomUUID(),
        correlationId: randomUUID(),
        actor: dto.actor,
      }, dto.transactionId),
    );

    return { status: 'accepted' };
  }

  @Post(':accountId/freeze')
  async freeze(
    @Param('accountId') accountId: string,
    @Body() dto: FreezeAccountDto,
  ): Promise<{ status: string }> {
    await this.commandBus.execute(
      new FreezeAccountCommand(accountId, dto.reason, {
        commandId: randomUUID(),
        correlationId: randomUUID(),
        actor: dto.actor,
      }),
    );

    return { status: 'accepted' };
  }
}
