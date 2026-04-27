export const TransferEventTypes = {
  TransferInitiated: 'TransferInitiated',
  TransferDebitStarted: 'TransferDebitStarted',
  TransferDebited: 'TransferDebited',
  TransferCreditStarted: 'TransferCreditStarted',
  TransferCompleted: 'TransferCompleted',
  TransferFailed: 'TransferFailed',
  TransferCompensationStarted: 'TransferCompensationStarted',
  TransferCompensated: 'TransferCompensated',
} as const;
