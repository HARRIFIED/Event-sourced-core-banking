import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class TransferSaga {
  private readonly logger = new Logger(TransferSaga.name);

  onTransferInitiated(transferId: string): void {
    this.logger.debug(`Transfer saga started for transfer=${transferId}`);
  }

  onTransferFailed(transferId: string): void {
    this.logger.warn(`Transfer saga failed for transfer=${transferId}; compensation should run.`);
  }
}
