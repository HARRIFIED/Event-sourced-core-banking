export type TransferSagaStep =
  | 'INITIATED'
  | 'DEBITED'
  | 'CREDITED'
  | 'COMPLETED'
  | 'FAILED'
  | 'COMPENSATED';

export interface TransferSagaState {
  transferId: string;
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  currency: string;
  step: TransferSagaStep;
  retries: number;
}
