import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { AccountsModule } from '../accounts/accounts.module';
import { InfrastructureModule } from '../../infrastructure/infrastructure.module';
import { TransfersController } from './transfers.controller';
import { TransferRepository } from './domain/transfer.repository';
import { TransferProjector } from './query/transfer-projector.service';
import { TransferCoordinatorService } from './application/services/transfer-coordinator.service';
import { TransferCommandHandlers } from './application/handlers/transfer-command.handlers';

@Module({
  imports: [CqrsModule, AccountsModule, InfrastructureModule],
  controllers: [TransfersController],
  providers: [TransferRepository, TransferProjector, TransferCoordinatorService, ...TransferCommandHandlers],
  exports: [TransferRepository, TransferProjector, TransferCoordinatorService],
})
export class TransfersModule {}
