import type { Pool } from 'pg';
import {
  AuthAuditLogRepository,
  AuthAuditRecord,
} from '../../domain/ports/auth-audit-log.repository.interface.js';

export class PgAuthAuditLogRepository implements AuthAuditLogRepository {
  constructor(private readonly pool: Pool) {}

  async record(entry: AuthAuditRecord): Promise<void> {
    const query = `
      INSERT INTO identity.auth_audit_logs (
        id, user_id, email, event_type, ip_address, user_agent, correlation_id, metadata, created_at
      ) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW())
    `;

    await this.pool.query(query, [
      entry.userId ?? null,
      entry.email ?? null,
      entry.eventType,
      entry.ipAddress,
      entry.userAgent ?? null,
      entry.correlationId ?? null,
      JSON.stringify(entry.metadata ?? {}),
    ]);
  }
}
