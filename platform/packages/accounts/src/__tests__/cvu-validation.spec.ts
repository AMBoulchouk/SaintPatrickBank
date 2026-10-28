import { describe, it, expect } from 'vitest';
import { CVU } from '../domain/value-objects/cvu.js';

describe('CVU Value Object - COELSA Weighted Modulo 10 Verification', () => {
  it('should accept a mathematically valid synthetic CVU', () => {
    // Generate known valid CVU using official weights
    const testCvu = CVU.createForTesting('000', '0001', '1');
    expect(testCvu.value).toHaveLength(22);
    expect(CVU.isValid(testCvu.value)).toBe(true);

    const instance = new CVU(testCvu.value);
    expect(instance.value).toBe(testCvu.value);
    expect(instance.pspCode).toBe('000');
    expect(instance.branchCode).toBe('0001');
    expect(instance.accountNumber).toBe('0000000000001');
  });

  it('should reject non-numeric or invalid length strings', () => {
    expect(() => new CVU('12345')).toThrow('must be exactly 22 numeric digits');
    expect(() => new CVU('000000170000000000001A')).toThrow('must be exactly 22 numeric digits');
    expect(() => new CVU('   ')).toThrow('must be exactly 22 numeric digits');
  });

  it('should reject CVU when Block 1 check digit is corrupted or altered', () => {
    const valid = CVU.createForTesting('000', '0001', '1').value;
    // Alter digit 8 (index 7)
    const corruptedD1 =
      valid.substring(0, 7) +
      (valid[7] === '9' ? '0' : String(Number(valid[7]) + 1)) +
      valid.substring(8);

    expect(CVU.isValid(corruptedD1)).toBe(false);
    expect(() => new CVU(corruptedD1)).toThrow(/Invalid CVU Block 1 check digit/);
  });

  it('should reject CVU when Block 2 check digit is corrupted or altered', () => {
    const valid = CVU.createForTesting('000', '0001', '1').value;
    // Alter digit 22 (index 21)
    const corruptedD2 =
      valid.substring(0, 21) +
      (valid[21] === '9' ? '0' : String(Number(valid[21]) + 1));

    expect(CVU.isValid(corruptedD2)).toBe(false);
    expect(() => new CVU(corruptedD2)).toThrow(/Invalid CVU Block 2 check digit/);
  });

  it('should reject single-digit transpositions in account number', () => {
    // Generate valid CVU for account '12'
    const valid = CVU.createForTesting('000', '0001', '12').value;
    // Transpose last two account digits (indices 19 and 20)
    const chars = valid.split('');
    const temp = chars[19];
    chars[19] = chars[20]!;
    chars[20] = temp!;
    const transposed = chars.join('');

    if (transposed !== valid) {
      expect(CVU.isValid(transposed)).toBe(false);
      expect(() => new CVU(transposed)).toThrow();
    }
  });

  it('should verify equality correctly', () => {
    const cvu1 = CVU.createForTesting('000', '0001', '100');
    const cvu2 = CVU.createForTesting('000', '0001', '100');
    const cvu3 = CVU.createForTesting('000', '0001', '200');

    expect(cvu1.equals(cvu2)).toBe(true);
    expect(cvu1.equals(cvu3)).toBe(false);
    expect(cvu1.toString()).toBe(cvu1.value);
  });
});
