import type { Pool } from 'pg';
import { UserSessionRepository } from '../../domain/ports/user-session.repository.interface.js';
import { UserSession } from '../../domain/entities/user-session.entity.js';

interface UserSessionRow {
  readonly id: string;
  readonly user_id: string;
  readonly refresh_token_hash: string;
  readonly session_family_id: string;
  readonly is_used: boolean;
  readonly device_fingerprint: string | null;
  readonly ip_address: string;
  readonly user_agent: string | null;
  readonly expires_at: Date;
  readonly revoked_at: Date | null;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export class PgUserSessionRepository implements UserSessionRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<UserSession | null> {
    const res = await this.pool.query<UserSessionRow>(
      'SELECT * FROM identity.user_sessions WHERE id = $1',
      [id]
    );
    const row = res.rows[0];
    if (!row) return null;
    return this.mapToEntity(row);
  }

  async findByRefreshTokenHash(hash: string): Promise<UserSession | null> {
    const res = await this.pool.query<UserSessionRow>(
      'SELECT * FROM identity.user_sessions WHERE refresh_token_hash = $1',
      [hash]
    );
    const row = res.rows[0];
    if (!row) return null;
    return this.mapToEntity(row);
  }

  async findActiveByUserId(userId: string): Promise<readonly UserSession[]> {
    const res = await this.pool.query<UserSessionRow>(
      `SELECT * FROM identity.user_sessions 
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > NOW() AND is_used = FALSE
       ORDER BY created_at DESC`,
      [userId]
    );
    return res.rows.map((row) => this.mapToEntity(row));
  }

  async save(session: UserSession): Promise<void> {
    const query = `
      INSERT INTO identity.user_sessions (
        id, user_id, refresh_token_hash, session_family_id,
        is_used, device_fingerprint, ip_address, user_agent,
        expires_at, revoked_at, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        is_used = EXCLUDED.is_used,
        revoked_at = EXCLUDED.revoked_at,
        updated_at = EXCLUDED.updated_at
    `;

    await this.pool.query(query, [
      session.id,
      session.userId,
      session.refreshTokenHash,
      session.sessionFamilyId,
      session.isUsed,
      session.deviceFingerprint,
      session.ipAddress,
      session.userAgent,
      session.expiresAt,
      session.revokedAt,
      session.createdAt,
      session.updatedAt,
    ]);
  }

  async revokeAllForFamily(familyId: string): Promise<void> {
    await this.pool.query(
      `UPDATE identity.user_sessions 
       SET revoked_at = NOW(), updated_at = NOW() 
       WHERE session_family_id = $1 AND revoked_at IS NULL`,
      [familyId]
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.pool.query(
      `UPDATE identity.user_sessions 
       SET revoked_at = NOW(), updated_at = NOW() 
       WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
  }

  private mapToEntity(row: UserSessionRow): UserSession {
    return new UserSession({
      id: row.id,
      userId: row.user_id,
      refreshTokenHash: row.refresh_token_hash,
      sessionFamilyId: row.session_family_id,
      isUsed: row.is_used,
      deviceFingerprint: row.device_fingerprint,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}
