import { Body, Controller, DefaultValuePipe, Get, Headers, Inject, NotFoundException, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { randomUUID } from 'crypto';
import { IdempotencyService } from '../../infrastructure/idempotency/idempotency.service';
import {
  ACCOUNT_READ_MODEL_REPOSITORY,
  AccountReadModelRepository,
  AccountStatementEntryReadModel,
  AccountSummaryReadModel,
} from './query/account-read-model.repository';
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
  constructor(
    private readonly commandBus: CommandBus,
    private readonly idempotencyService: IdempotencyService,
    @Inject(ACCOUNT_READ_MODEL_REPOSITORY)
    private readonly readModels: AccountReadModelRepository,
  ) {}

  @Post()
  async createAccount(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateAccountDto,
  ): Promise<{ status: string }> {
    return this.idempotencyService.execute(
      idempotencyKey,
      'accounts.create',
      dto,
      async () => {
        await this.commandBus.execute(
          new CreateAccountCommand(dto.accountId, dto.ownerId, dto.currency, {
            commandId: idempotencyKey!,
            correlationId: randomUUID(),
            actor: dto.actor,
          }),
        );

        return { status: 'accepted' };
      },
    );
  }

  @Post(':accountId/deposits')
  async deposit(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('accountId') accountId: string,
    @Body() dto: DepositMoneyDto,
  ): Promise<{ status: string }> {
    return this.idempotencyService.execute(
      idempotencyKey,
      'accounts.deposit',
      { accountId, ...dto },
      async () => {
        await this.commandBus.execute(
          new DepositMoneyCommand(accountId, dto.amount, dto.currency, {
            commandId: idempotencyKey!,
            correlationId: randomUUID(),
            actor: dto.actor,
          }, dto.transactionId),
        );

        return { status: 'accepted' };
      },
    );
  }

  @Post(':accountId/withdrawals')
  async withdraw(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('accountId') accountId: string,
    @Body() dto: WithdrawMoneyDto,
  ): Promise<{ status: string }> {
    return this.idempotencyService.execute(
      idempotencyKey,
      'accounts.withdraw',
      { accountId, ...dto },
      async () => {
        await this.commandBus.execute(
          new WithdrawMoneyCommand(accountId, dto.amount, dto.currency, {
            commandId: idempotencyKey!,
            correlationId: randomUUID(),
            actor: dto.actor,
          }, dto.transactionId),
        );

        return { status: 'accepted' };
      },
    );
  }

  @Post(':accountId/freeze')
  async freeze(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('accountId') accountId: string,
    @Body() dto: FreezeAccountDto,
  ): Promise<{ status: string }> {
    return this.idempotencyService.execute(
      idempotencyKey,
      'accounts.freeze',
      { accountId, ...dto },
      async () => {
        await this.commandBus.execute(
          new FreezeAccountCommand(accountId, dto.reason, {
            commandId: idempotencyKey!,
            correlationId: randomUUID(),
            actor: dto.actor,
          }),
        );

        return { status: 'accepted' };
      },
    );
  }

  @Get(':accountId')
  async getAccountDetails(@Param('accountId') accountId: string): Promise<AccountSummaryReadModel> {
    const summary = await this.readModels.getAccountSummary(accountId);
    if (!summary) {
      throw new NotFoundException(`Account ${accountId} not found`);
    }

    return summary;
  }

  @Get(':accountId/balance')
  async getAccountBalance(@Param('accountId') accountId: string): Promise<{
    accountId: string;
    balance: number;
    currency: string;
    status: 'ACTIVE' | 'FROZEN';
    version: number;
  }> {
    const summary = await this.readModels.getAccountSummary(accountId);
    if (!summary) {
      throw new NotFoundException(`Account ${accountId} not found`);
    }

    return {
      accountId: summary.accountId,
      balance: summary.balance,
      currency: summary.currency,
      status: summary.status,
      version: summary.version,
    };
  }

  @Get(':accountId/history')
  async getAccountHistory(
    @Param('accountId') accountId: string,
    @Query('limit', new DefaultValuePipe(100), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ): Promise<{ accountId: string; entries: AccountStatementEntryReadModel[] }> {
    const summary = await this.readModels.getAccountSummary(accountId);
    if (!summary) {
      throw new NotFoundException(`Account ${accountId} not found`);
    }

    return {
      accountId,
      entries: await this.readModels.getAccountStatement(accountId, limit, offset),
    };
  }
}
