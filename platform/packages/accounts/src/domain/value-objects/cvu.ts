/**
 * Value Object: CVU (Clave Virtual Uniforme)
 * Standard 22-digit numeric identifier for Payment Service Providers in Argentina (COELSA / BCRA standard).
 *
 * Structure:
 * - Block 1 (8 digits):
 *   - Digits 1-3: PSP Entity Code
 *   - Digits 4-7: Branch / Subsidiary Code
 *   - Digit 8: Verifier Digit 1 (Weighted Modulo 10 with weights [7, 1, 3, 9, 7, 1, 3])
 * - Block 2 (14 digits):
 *   - Digits 9-21: Account Number (13 digits)
 *   - Digit 22: Verifier Digit 2 (Weighted Modulo 10 with weights [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3])
 */
export class CVU {
  private static readonly WEIGHTS_BLOCK_1 = [7, 1, 3, 9, 7, 1, 3] as const;
  private static readonly WEIGHTS_BLOCK_2 = [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3] as const;

  private readonly _value: string;

  constructor(value: string) {
    const sanitized = value.trim();
    if (!/^\d{22}$/.test(sanitized)) {
      throw new Error(`Invalid CVU format: must be exactly 22 numeric digits, received '${sanitized}'`);
    }

    const block1Data = sanitized.substring(0, 7);
    const expectedD1 = CVU.computeBlock1CheckDigit(block1Data);
    const actualD1 = parseInt(sanitized[7]!, 10);

    if (actualD1 !== expectedD1) {
      throw new Error(
        `Invalid CVU Block 1 check digit: expected ${expectedD1}, received ${actualD1} for data '${block1Data}'`
      );
    }

    const block2Data = sanitized.substring(8, 21);
    const expectedD2 = CVU.computeBlock2CheckDigit(block2Data);
    const actualD2 = parseInt(sanitized[21]!, 10);

    if (actualD2 !== expectedD2) {
      throw new Error(
        `Invalid CVU Block 2 check digit: expected ${expectedD2}, received ${actualD2} for data '${block2Data}'`
      );
    }

    this._value = sanitized;
  }

  get value(): string {
    return this._value;
  }

  get pspBlock(): string {
    return this._value.substring(0, 8);
  }

  get accountBlock(): string {
    return this._value.substring(8, 22);
  }

  get pspCode(): string {
    return this._value.substring(0, 3);
  }

  get branchCode(): string {
    return this._value.substring(3, 7);
  }

  get accountNumber(): string {
    return this._value.substring(8, 21);
  }

  /**
   * Computes the official Modulo 10 check digit for Block 1 (first 7 digits).
   */
  static computeBlock1CheckDigit(first7Digits: string): number {
    if (!/^\d{7}$/.test(first7Digits)) {
      throw new Error(`Block 1 data must be exactly 7 numeric digits, received '${first7Digits}'`);
    }

    let sum = 0;
    for (let i = 0; i < 7; i++) {
      sum += parseInt(first7Digits[i]!, 10) * CVU.WEIGHTS_BLOCK_1[i]!;
    }

    return (10 - (sum % 10)) % 10;
  }

  /**
   * Computes the official Modulo 10 check digit for Block 2 (13 account digits).
   */
  static computeBlock2CheckDigit(account13Digits: string): number {
    if (!/^\d{13}$/.test(account13Digits)) {
      throw new Error(`Block 2 data must be exactly 13 numeric digits, received '${account13Digits}'`);
    }

    let sum = 0;
    for (let i = 0; i < 13; i++) {
      sum += parseInt(account13Digits[i]!, 10) * CVU.WEIGHTS_BLOCK_2[i]!;
    }

    return (10 - (sum % 10)) % 10;
  }

  /**
   * Validates whether a candidate string is a mathematically valid CVU without throwing.
   */
  static isValid(candidate: string): boolean {
    try {
      new CVU(candidate);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generates a mathematically valid synthetic CVU for isolated test suites.
   * WARNING: Synthetic test identifiers MUST NOT be presented as operational or real bank accounts.
   */
  static createForTesting(pspCode: string, branchCode: string, accountNumber: string): CVU {
    const paddedPsp = pspCode.padStart(3, '0').substring(0, 3);
    const paddedBranch = branchCode.padStart(4, '0').substring(0, 4);
    const block1Data = `${paddedPsp}${paddedBranch}`;
    const d1 = CVU.computeBlock1CheckDigit(block1Data);

    const paddedAccount = accountNumber.padStart(13, '0').substring(0, 13);
    const d2 = CVU.computeBlock2CheckDigit(paddedAccount);

    return new CVU(`${block1Data}${d1}${paddedAccount}${d2}`);
  }

  toString(): string {
    return this._value;
  }

  equals(other: CVU): boolean {
    return this._value === other._value;
  }
}
