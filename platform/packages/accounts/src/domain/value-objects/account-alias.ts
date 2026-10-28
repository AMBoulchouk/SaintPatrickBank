/**
 * Value Object: AccountAlias
 * Unique human-readable alias for Argentine Payment Accounts (BCRA standards).
 * Length between 6 and 20 chars, lowercase alphanumeric with optional dots or dashes.
 */
export class AccountAlias {
  private readonly _value: string;

  constructor(value: string) {
    const sanitized = value.trim().toLowerCase();
    if (!/^[a-z0-9.-]{6,20}$/.test(sanitized)) {
      throw new Error(`Invalid Account Alias: must be 6-20 alphanumeric characters, dots or hyphens. Received '${sanitized}'`);
    }
    this._value = sanitized;
  }

  get value(): string {
    return this._value;
  }

  toString(): string {
    return this._value;
  }

  equals(other: AccountAlias): boolean {
    return this._value === other._value;
  }
}
