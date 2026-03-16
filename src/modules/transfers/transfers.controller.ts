import { Body, Controller, Post } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { randomUUID } from 'crypto';
import { InitiateTransferDto } from './application/dto/initiate-transfer.dto';
import { InitiateTransferCommand } from './application/commands/initiate-transfer.command';

@Controller('transfers')
export class TransfersController {
  constructor(private readonly commandBus: CommandBus) {}

  @Post()
  async initiateTransfer(@Body() dto: InitiateTransferDto): Promise<{ transferId: string }> {
    const transferId = randomUUID();

    await this.commandBus.execute(
      new InitiateTransferCommand(
        transferId,
        dto.sourceAccountId,
        dto.destinationAccountId,
        dto.amount,
        dto.currency,
        {
          commandId: randomUUID(),
          correlationId: randomUUID(),
        },
      ),
    );

    return { transferId };
  }
}
