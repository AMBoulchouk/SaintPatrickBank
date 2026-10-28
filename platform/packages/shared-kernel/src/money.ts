/**
 * Value Object: Money
 * Enforces exact integer centavos representation (BigInt).
 * Banishes IEEE-754 floating point arithmetic from financial logic.
 */

export type CurrencyCode = 'ARS';

export class Money {
  private constructor(
    readonly amountCents: bigint,
    readonly currency: CurrencyCode = 'ARS',
  ) {}

  static fromCents(cents: bigint | number, currency: CurrencyCode = 'ARS'): Money {
    const bigintCents = typeof cents === 'number' ? BigInt(Math.trunc(cents)) : cents;
    return new Money(bigintCents, currency);
  }

  static fromApiString(amountStr: string, currency: CurrencyCode = 'ARS'): Money {
    if (!/^-?\d+$/.test(amountStr.trim())) {
      throw new Error(`Invalid monetary string format: "${amountStr}". Expected integer centavos as string.`);
    }
    return new Money(BigInt(amountStr.trim()), currency);
  }

  static zero(currency: CurrencyCode = 'ARS'): Money {
    return new Money(0n, currency);
  }

  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountCents + other.amountCents, this.currency);
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.amountCents - other.amountCents, this.currency);
  }

  isPositive(): boolean {
    return this.amountCents > 0n;
  }

  isZero(): boolean {
    return this.amountCents === 0n;
  }

  isNegative(): boolean {
    return this.amountCents < 0n;
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountCents === other.amountCents;
  }

  /**
   * Safe serialization for REST JSON APIs and event contracts.
   * Prevents precision loss beyond 2^53 - 1 in client runtimes.
   */
  toApiString(): string {
    return this.amountCents.toString();
  }

  /**
   * Formatted string representation for logging or display (e.g. "ARS 1000.50").
   */
  format(): string {
    const isNegative = this.amountCents < 0n;
    const absCents = isNegative ? -this.amountCents : this.amountCents;
    const units = absCents / 100n;
    const cents = absCents % 100n;
    const sign = isNegative ? '-' : '';
    return `${this.currency} ${sign}${units.toString()}.${cents.toString().padStart(2, '0')}`;
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new Error(`Currency mismatch: cannot operate between ${this.currency} and ${other.currency}`);
    }
  }
}
