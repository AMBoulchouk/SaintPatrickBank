/**
 * Structured Financial Logger
 * Emits JSON logs compatible with OpenTelemetry / ELK.
 * Enforces deep sanitization of PII, credentials, CVU, CUIT, PAN and database URLs
 * across log payloads, messages, and stack traces.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  data?: Record<string, unknown>;
  traceId?: string;
}

const SENSITIVE_KEYS = new Set([
  'pin',
  'password',
  'token',
  'secret',
  'authorization',
  'cvu',
  'dni',
  'cuit',
  'cuil',
  'pan',
  'cardnumber',
  'card_number',
  'accountnumber',
  'account_number',
  'cookie',
  'bearer',
  'privatekey',
  'private_key',
  'email',
  'phone',
  'telephone',
  'address',
]);

const SENSITIVE_PATTERNS: Array<{ regex: RegExp; replacement: string }> = [
  // Database connection strings containing passwords
  { regex: /(postgres(?:ql)?:\/\/[^:]+:)([^@]+)(@)/gi, replacement: '$1[REDACTED]$3' },
  // Bearer authentication tokens
  { regex: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, replacement: 'Bearer [REDACTED]' },
  // 22-digit Argentine CVU/CBU
  { regex: /\b\d{22}\b/g, replacement: '[REDACTED_CVU]' },
  // 16-digit Payment Card PANs (with optional spaces or dashes)
  { regex: /\b(?:\d{4}[ -]?){3}\d{4}\b/g, replacement: '[REDACTED_PAN]' },
  // Argentine CUIT/CUIL numbers (11 digits: 20/23/24/27/30/33/34-xxxxxxxx-x)
  { regex: /\b(20|23|24|27|30|33|34)[ -]?\d{8}[ -]?\d\b/g, replacement: '[REDACTED_CUIT]' },
];

export function sanitizeText(text: string): string {
  let sanitized = text;
  for (const { regex, replacement } of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(regex, replacement);
  }
  return sanitized;
}

export function sanitizeLogData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const sanitized: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(data)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, '');
    if (SENSITIVE_KEYS.has(normalizedKey)) {
      sanitized[key] = '[REDACTED]';
    } else if (val instanceof Error) {
      sanitized[key] = {
        name: val.name,
        message: sanitizeText(val.message),
        ...(val.stack ? { stack: sanitizeText(val.stack) } : {}),
      };
    } else if (typeof val === 'string') {
      sanitized[key] = sanitizeText(val);
    } else if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
      sanitized[key] = sanitizeLogData(val as Record<string, unknown>);
    } else {
      sanitized[key] = val;
    }
  }

  return sanitized;
}

export class StructuredLogger {
  constructor(
    private readonly context: string,
    private readonly minLevel: LogLevel = 'info',
  ) {}

  private readonly levelWeights: Record<LogLevel, number> = {
    debug: 10,
    info: 20,
    warn: 30,
    error: 40,
  };

  private shouldLog(level: LogLevel): boolean {
    return this.levelWeights[level] >= this.levelWeights[this.minLevel];
  }

  log(level: LogLevel, message: string, data?: Record<string, unknown>, traceId?: string): StructuredLogEntry {
    const sanitizedData = sanitizeLogData(data);
    const sanitizedMessage = sanitizeText(message);

    const entry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message: sanitizedMessage,
      ...(sanitizedData ? { data: sanitizedData } : {}),
      ...(traceId ? { traceId } : {}),
    };

    if (this.shouldLog(level)) {
      const output = JSON.stringify(entry);
      if (level === 'error') {
        process.stderr.write(output + '\n');
      } else {
        process.stdout.write(output + '\n');
      }
    }

    return entry;
  }

  info(message: string, data?: Record<string, unknown>, traceId?: string): StructuredLogEntry {
    return this.log('info', message, data, traceId);
  }

  debug(message: string, data?: Record<string, unknown>, traceId?: string): StructuredLogEntry {
    return this.log('debug', message, data, traceId);
  }

  warn(message: string, data?: Record<string, unknown>, traceId?: string): StructuredLogEntry {
    return this.log('warn', message, data, traceId);
  }

  error(message: string, data?: Record<string, unknown>, traceId?: string): StructuredLogEntry {
    return this.log('error', message, data, traceId);
  }
}
