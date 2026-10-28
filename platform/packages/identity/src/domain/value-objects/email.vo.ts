export class Email {
  private readonly _value: string;

  constructor(value: string) {
    const trimmed = value.trim().toLowerCase();
    // Standard robust email regex (RFC 5322 compliant subset)
    const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
    
    if (!trimmed || !emailRegex.test(trimmed)) {
      throw new Error(`Invalid email address format: '${value}'`);
    }

    if (trimmed.length > 255) {
      throw new Error('Email address exceeds maximum allowed length of 255 characters');
    }

    this._value = trimmed;
  }

  get value(): string {
    return this._value;
  }

  toString(): string {
    return this._value;
  }

  equals(other: Email): boolean {
    return this._value === other._value;
  }
}
