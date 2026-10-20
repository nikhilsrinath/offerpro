import { describe, it, expect, afterEach } from 'vitest';
import {
  setBaseCurrency, baseCurrency, currencySymbol, recordCurrency,
  formatCurrency, formatCurrencyShort, compactNumber,
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
    expect(formatCurrency(150000)).toBe('₹1,50,000');
    setBaseCurrency('USD');
    expect(formatCurrency(150000)).toBe('$150,000');
    expect(formatCurrency(-12.5)).toBe('−$12.5');
  });

  it('shortens in lakh/crore for INR and in M/B elsewhere', () => {
    expect(formatCurrencyShort(12400000)).toBe('₹1.24Cr');
    expect(formatCurrencyShort(310000)).toBe('₹3.10L');
    setBaseCurrency('USD');
    expect(formatCurrencyShort(1240000)).toBe('$1.24M');
    expect(formatCurrencyShort(310000)).toBe('$310.0k');
    expect(compactNumber(-4500)).toBe('-4.5k');
  });
});
