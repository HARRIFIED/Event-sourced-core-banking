const MONEY_SCALE = 2;
const MONEY_PATTERN = /^-?\d+(\.\d{1,2})?$/;

export function parseMoneyToMinorUnits(value: number | string): bigint {
  const normalized = normalizeMoneyInput(value);
  const negative = normalized.startsWith('-');
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [wholePart, fractionPart = ''] = unsigned.split('.');
  const paddedFraction = fractionPart.padEnd(MONEY_SCALE, '0');
  const minorUnits = BigInt(`${wholePart}${paddedFraction}`);
  return negative ? -minorUnits : minorUnits;
}

export function formatMinorUnitsToMoney(minorUnits: bigint): string {
  const negative = minorUnits < 0n;
  const absolute = negative ? -minorUnits : minorUnits;
  const raw = absolute.toString().padStart(MONEY_SCALE + 1, '0');
  const whole = raw.slice(0, -MONEY_SCALE);
  const fraction = raw.slice(-MONEY_SCALE);
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

export function parseMoneyToNumber(value: number | string): number {
  return Number(formatMinorUnitsToMoney(parseMoneyToMinorUnits(value)));
}

export function minorUnitsToNumber(minorUnits: bigint): number {
  return Number(formatMinorUnitsToMoney(minorUnits));
}

function normalizeMoneyInput(value: number | string): string {
  const normalized = typeof value === 'number' ? value.toString() : value.trim();
  if (!MONEY_PATTERN.test(normalized)) {
    throw new Error(`Invalid money amount: ${value}`);
  }

  return normalized;
}
