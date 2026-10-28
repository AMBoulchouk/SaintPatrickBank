import { describe, it, expect } from 'vitest';
import { ok, err } from '../result.js';

describe('Result Pattern', () => {
  it('should unwrap Ok value correctly', () => {
    const res = ok(42);
    expect(res.isOk).toBe(true);
    expect(res.isErr).toBe(false);
    expect(res.unwrap()).toBe(42);
  });

  it('should map Ok value', () => {
    const res = ok('saintpatrick').map((s) => s.toUpperCase());
    expect(res.unwrap()).toBe('SAINTPATRICK');
  });

  it('should handle Err and throw on unwrap', () => {
    const res = err('DATABASE_CONNECTION_LOST');
    expect(res.isOk).toBe(false);
    expect(res.isErr).toBe(true);
    expect(() => res.unwrap()).toThrow('Attempted to unwrap an Err: DATABASE_CONNECTION_LOST');
    expect(res.unwrapOr('fallback')).toBe('fallback');
  });

  it('should mapErr on error', () => {
    const res = err(404).mapErr((code) => `Status: ${code}`);
    expect(res.isErr).toBe(true);
    if (res.isErr) {
      expect(res.error).toBe('Status: 404');
    }
  });
});
