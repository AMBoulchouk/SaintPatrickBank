import { describe, it, expect } from 'vitest';
import { Money } from '../money.js';

describe('Money Value Object', () => {
  it('should initialize money in exact centavos', () => {
    const m = Money.fromCents(10050n, 'ARS');
    expect(m.amountCents).toBe(10050n);
    expect(m.currency).toBe('ARS');
    expect(m.format()).toBe('ARS 100.50');
  });

  it('should serialize safely for JSON APIs as string', () => {
    const m = Money.fromCents(9007199254740992n, 'ARS'); // > Number.MAX_SAFE_INTEGER
    expect(m.toApiString()).toBe('9007199254740992');
  });

  it('should parse safely from API string', () => {
    const m = Money.fromApiString('50025', 'ARS');
    expect(m.amountCents).toBe(50025n);
    expect(m.format()).toBe('ARS 500.25');
  });

  it('should reject invalid monetary API strings', () => {
    expect(() => Money.fromApiString('12.50')).toThrow('Invalid monetary string format');
    expect(() => Money.fromApiString('abc')).toThrow('Invalid monetary string format');
  });

  it('should execute exact additions and subtractions', () => {
    const a = Money.fromCents(25000n, 'ARS');
    const b = Money.fromCents(15050n, 'ARS');
    const sum = a.add(b);
    const diff = a.subtract(b);

    expect(sum.amountCents).toBe(40050n);
    expect(diff.amountCents).toBe(9950n);
    expect(sum.format()).toBe('ARS 400.50');
    expect(diff.format()).toBe('ARS 99.50');
  });

  it('should format negative values accurately', () => {
    const neg = Money.fromCents(-350n, 'ARS');
    expect(neg.isNegative()).toBe(true);
    expect(neg.format()).toBe('ARS -3.50');
  });
});
