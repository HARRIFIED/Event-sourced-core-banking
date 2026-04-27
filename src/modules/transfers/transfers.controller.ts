import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { InitiateTransferDto } from './application/dto/initiate-transfer.dto';
import { InitiateTransferCommand } from './application/commands/initiate-transfer.command';
import { IdempotencyService } from '../../infrastructure/idempotency/idempotency.service';
import {
  TRANSFER_READ_MODEL_REPOSITORY,
  TransferReadModelRepository,
  TransferSummaryReadModel,
} from './query/transfer-read-model.repository';

@Controller('transfers')
export class TransfersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly idempotencyService: IdempotencyService,
    @Inject(TRANSFER_READ_MODEL_REPOSITORY)
    private readonly readModels: TransferReadModelRepository,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async initiateTransfer(
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: InitiateTransferDto,
  ): Promise<{ transferId: string; status: string }> {
    return this.idempotencyService.execute(
      idempotencyKey,
      'transfers.initiate',
      dto,
      async () => {
        await this.commandBus.execute(
          new InitiateTransferCommand(
            dto.transferId,
            dto.sourceAccountId,
            dto.destinationAccountId,
            dto.amount,
            dto.currency,
            {
              commandId: idempotencyKey!,
              correlationId: dto.transferId,
              actor: 'transfer-api',
            },
          ),
        );

        return { transferId: dto.transferId, status: 'accepted' };
      },
    );
  }

  @Get(':transferId')
  async getTransferStatus(@Param('transferId') transferId: string): Promise<TransferSummaryReadModel> {
    const summary = await this.readModels.getTransferSummary(transferId);
    if (!summary) {
      throw new NotFoundException(`Transfer ${transferId} not found`);
    }

    return summary;
  }
}
