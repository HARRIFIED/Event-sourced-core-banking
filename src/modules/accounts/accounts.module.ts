import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AccountsController } from './accounts.controller';
import { AccountRepository } from './domain/account.repository';
import { AccountCommandHandlers } from './application/handlers/account-command.handlers';

@Module({
  imports: [CqrsModule],
  controllers: [AccountsController],
  providers: [AccountRepository, ...AccountCommandHandlers],
  exports: [AccountRepository],
})
export class AccountsModule {}
