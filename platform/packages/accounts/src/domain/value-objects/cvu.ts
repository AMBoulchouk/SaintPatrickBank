/**
 * Value Object: CVU (Clave Virtual Uniforme)
 * Standard 22-digit alphanumeric identifier for Payment Service Providers in Argentina (COELSA).
 */
export class CVU {
  private readonly _value: string;

  constructor(value: string) {
    const sanitized = value.trim();
    if (!/^\d{22}$/.test(sanitized)) {
      throw new Error(`Invalid CVU format: must be exactly 22 numeric digits, received '${sanitized}'`);
    }
    this._value = sanitized;
  }

  get value(): string {
    return this._value;
  }

  /**
   * First 8 digits identify the Payment Service Provider (PSP) and verification digit 1.
   */
  get pspBlock(): string {
    return this._value.substring(0, 8);
  }

  /**
   * Remaining 14 digits identify the specific customer account and verification digit 2.
   */
  get accountBlock(): string {
    return this._value.substring(8, 22);
  }

  toString(): string {
    return this._value;
  }

  equals(other: CVU): boolean {
    return this._value === other._value;
  }
}
