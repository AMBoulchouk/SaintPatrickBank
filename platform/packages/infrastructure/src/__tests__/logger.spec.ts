import { describe, it, expect } from 'vitest';
import { StructuredLogger, sanitizeLogData, sanitizeText } from '../logger.js';

describe('StructuredLogger Deep Sanitization', () => {
  it('should redact sensitive keys from log data', () => {
    const raw = {
      userId: 'usr_123',
      pin: '1234',
      cvu: '0000003100012345678901',
      password: 'superSecretPassword',
      email: 'investor@example.com',
      cuit: '20-12345678-9',
      nested: {
        token: 'jwt_token_here',
        amount: 5000,
      },
    };

    const sanitized = sanitizeLogData(raw);

    expect(sanitized?.['userId']).toBe('usr_123');
    expect(sanitized?.['pin']).toBe('[REDACTED]');
    expect(sanitized?.['cvu']).toBe('[REDACTED]');
    expect(sanitized?.['password']).toBe('[REDACTED]');
    expect(sanitized?.['email']).toBe('[REDACTED]');
    expect(sanitized?.['cuit']).toBe('[REDACTED]');
    const nested = sanitized?.['nested'] as Record<string, unknown>;
    expect(nested?.['token']).toBe('[REDACTED]');
    expect(nested?.['amount']).toBe(5000);
  });

  it('should sanitize credentials inside error messages and connection strings', () => {
    const errorWithUrl = new Error(
      'Database connection failed at postgresql://spbk_app:superSecretDbPass123@10.0.0.1:5432/saintpatrickbk_dev',
    );
    const sanitized = sanitizeLogData({ err: errorWithUrl });
    const errObj = sanitized?.['err'] as { message: string };

    expect(errObj.message).toContain('postgresql://spbk_app:[REDACTED]@10.0.0.1:5432/saintpatrickbk_dev');
    expect(errObj.message).not.toContain('superSecretDbPass123');
  });

  it('should scrub CVU, PAN, and Bearer tokens inside free text messages', () => {
    const message =
      'Transfer rejected for CVU 0000003100012345678901 card 4532-1234-5678-9012 with Bearer eyJhbGciOiJIUzI1NiJ9';
    const cleaned = sanitizeText(message);

    expect(cleaned).toContain('[REDACTED_CVU]');
    expect(cleaned).toContain('[REDACTED_PAN]');
    expect(cleaned).toContain('Bearer [REDACTED]');
    expect(cleaned).not.toContain('0000003100012345678901');
    expect(cleaned).not.toContain('4532-1234-5678-9012');
  });

  it('should format structured log entry with timestamp and context', () => {
    const logger = new StructuredLogger('TestContext', 'debug');
    const entry = logger.info('Test financial message', { amountCents: '10000' }, 'trace_abc');

    expect(entry.context).toBe('TestContext');
    expect(entry.level).toBe('info');
    expect(entry.message).toBe('Test financial message');
    expect(entry.traceId).toBe('trace_abc');
    expect(entry.data?.['amountCents']).toBe('10000');
    expect(typeof entry.timestamp).toBe('string');
  });
});
