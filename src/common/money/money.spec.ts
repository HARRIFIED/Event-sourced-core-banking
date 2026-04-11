import {
  formatMinorUnitsToMoney,
  parseMoneyToMinorUnits,
  parseMoneyToNumber,
} from './money';

describe('money utilities', () => {
  it('parses decimal money values into minor units', () => {
    expect(parseMoneyToMinorUnits('10.23')).toBe(1023n);
    expect(parseMoneyToMinorUnits('0.05')).toBe(5n);
    expect(parseMoneyToMinorUnits(15)).toBe(1500n);
  });

  it('formats minor units back into decimal strings', () => {
    expect(formatMinorUnitsToMoney(1023n)).toBe('10.23');
    expect(formatMinorUnitsToMoney(5n)).toBe('0.05');
  });

  it('rejects values with more than two decimal places', () => {
    expect(() => parseMoneyToMinorUnits('10.235')).toThrow('Invalid money amount');
  });

  it('preserves decimal semantics when converted back to number', () => {
    expect(parseMoneyToNumber('12.34')).toBe(12.34);
  });
});
