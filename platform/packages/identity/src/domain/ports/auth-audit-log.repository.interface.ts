export type AuthAuditEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'TOKEN_REFRESH'
  | 'TOKEN_REUSE_DETECTED'
  | 'LOGOUT'
  | 'SESSION_REVOKED'
  | 'PASSWORD_RESET_REQUESTED'
  | 'PASSWORD_RESET_COMPLETED'
  | 'MFA_CHALLENGE_FAILED'
  | 'MFA_CHALLENGE_SUCCEEDED'
  | 'ACCOUNT_LOCKED';

export interface AuthAuditRecord {
  readonly userId?: string | null | undefined;
  readonly email?: string | null | undefined;
  readonly eventType: AuthAuditEventType;
  readonly ipAddress: string;
  readonly userAgent?: string | null | undefined;
  readonly correlationId?: string | null | undefined;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface AuthAuditLogRepository {
  record(entry: AuthAuditRecord): Promise<void>;
}
