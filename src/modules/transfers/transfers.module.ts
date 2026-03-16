import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AccountsModule } from '../accounts/accounts.module';
import { InitiateTransferHandler } from './application/handlers/initiate-transfer.handler';
import { TransferSaga } from './application/sagas/transfer.saga';
import { TransfersController } from './transfers.controller';

@Module({
  imports: [CqrsModule, AccountsModule],
  controllers: [TransfersController],
  providers: [InitiateTransferHandler, TransferSaga],
})
export class TransfersModule {}
