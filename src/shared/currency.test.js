import { describe, it, expect, afterEach } from 'vitest';
import {
  setBaseCurrency, baseCurrency, currencySymbol, recordCurrency,
  formatCurrency, formatCurrencyShort, compactNumber, formatPercent,
} from './currency.js';

afterEach(() => setBaseCurrency('INR'));

describe('org currency', () => {
  it('defaults to INR and ignores junk', () => {
    expect(baseCurrency()).toBe('INR');
    setBaseCurrency('');
    expect(baseCurrency()).toBe('INR');
    setBaseCurrency('us');
    expect(baseCurrency()).toBe('INR');
    setBaseCurrency('usd');
    expect(baseCurrency()).toBe('USD');
  });

  it('gives the symbol of the base currency, or of a named one', () => {
    expect(currencySymbol()).toBe('₹');
    setBaseCurrency('GBP');
    expect(currencySymbol()).toBe('£');
    expect(currencySymbol('USD')).toBe('$');
    expect(currencySymbol('XYZ')).toBe('XYZ ');
  });

  it('treats INR or nothing on a record as the org currency, and keeps any other code', () => {
    setBaseCurrency('USD');
    expect(recordCurrency('INR')).toBe('USD');
    expect(recordCurrency(null)).toBe('USD');
    expect(recordCurrency('eur')).toBe('EUR');
  });

  it('groups digits the way the currency is read', () => {
    expect(formatCurrency(150000)).toBe('₹1,50,000.00');
    setBaseCurrency('USD');
    expect(formatCurrency(150000)).toBe('$150,000.00');
    expect(formatCurrency(-12.5)).toBe('−$12.50');
  });

  it('never drops below two decimals, even when asked for none', () => {
    expect(formatCurrency(1234, { digits: 0 })).toBe('₹1,234.00');
  });

  it('never shortens to L / Cr / M / k', () => {
    expect(formatCurrencyShort(12400000)).toBe('₹1,24,00,000.00');
    expect(formatCurrencyShort(310000)).toBe('₹3,10,000.00');
    setBaseCurrency('USD');
    expect(formatCurrencyShort(1240000)).toBe('$1,240,000.00');
    expect(compactNumber(-4500)).toBe('-4,500.00');
  });

  it('prints percentages with two decimals', () => {
    expect(formatPercent(12.5)).toBe('12.50%');
    expect(formatPercent(3, { signed: true })).toBe('+3.00%');
    expect(formatPercent(-4.256)).toBe('−4.26%');
  });
});
