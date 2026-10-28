import type { Pool, PoolClient } from 'pg';
import { UserRepository } from '../../domain/ports/user.repository.interface.js';
import { User } from '../../domain/entities/user.entity.js';
import { Email } from '../../domain/value-objects/email.vo.js';
import { PasswordHash } from '../../domain/value-objects/password-hash.vo.js';
import {
  KycVerificationStatus,
  UserLifecycleStatus,
} from '../../domain/value-objects/authenticated-principal.vo.js';

interface UserRow {
  readonly id: string;
  readonly email: string;
  readonly password_hash: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly tax_id: string;
  readonly status: string;
  readonly kyc_status: string;
  readonly email_verified_at: Date | null;
  readonly failed_login_attempts: number;
  readonly locked_until: Date | null;
  readonly is_mfa_enabled: boolean;
  readonly mfa_secret: string | null;
  readonly password_changed_at: Date;
  readonly created_at: Date;
  readonly updated_at: Date;
}

export class PgUserRepository implements UserRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<User | null> {
    const res = await this.pool.query<UserRow>(
      'SELECT * FROM identity.users WHERE id = $1',
      [id]
    );
    const row = res.rows[0];
    if (!row) return null;
    return this.mapToEntity(row);
  }

  async findByEmail(email: Email): Promise<User | null> {
    const res = await this.pool.query<UserRow>(
      'SELECT * FROM identity.users WHERE email = $1',
      [email.value]
    );
    const row = res.rows[0];
    if (!row) return null;
    return this.mapToEntity(row);
  }

  async findByTaxId(taxId: string): Promise<User | null> {
    const res = await this.pool.query<UserRow>(
      'SELECT * FROM identity.users WHERE tax_id = $1',
      [taxId.trim()]
    );
    const row = res.rows[0];
    if (!row) return null;
    return this.mapToEntity(row);
  }

  async findByIdWithLock(id: string, client?: unknown): Promise<User | null> {
    const dbClient = (client as PoolClient | undefined) ?? this.pool;
    const res = await dbClient.query<UserRow>(
      'SELECT * FROM identity.users WHERE id = $1 FOR UPDATE',
      [id]
    );
    const row = res.rows[0];
    if (!row) return null;
    return this.mapToEntity(row);
  }

  async save(user: User): Promise<void> {
    const query = `
      INSERT INTO identity.users (
        id, email, password_hash, first_name, last_name, tax_id,
        status, kyc_status, email_verified_at, failed_login_attempts,
        locked_until, is_mfa_enabled, mfa_secret, password_changed_at,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (id) DO UPDATE SET
        email = EXCLUDED.email,
        password_hash = EXCLUDED.password_hash,
        first_name = EXCLUDED.first_name,
        last_name = EXCLUDED.last_name,
        tax_id = EXCLUDED.tax_id,
        status = EXCLUDED.status,
        kyc_status = EXCLUDED.kyc_status,
        email_verified_at = EXCLUDED.email_verified_at,
        failed_login_attempts = EXCLUDED.failed_login_attempts,
        locked_until = EXCLUDED.locked_until,
        is_mfa_enabled = EXCLUDED.is_mfa_enabled,
        mfa_secret = EXCLUDED.mfa_secret,
        password_changed_at = EXCLUDED.password_changed_at,
        updated_at = EXCLUDED.updated_at
    `;

    await this.pool.query(query, [
      user.id,
      user.email.value,
      user.passwordHash.value,
      user.firstName,
      user.lastName,
      user.taxId,
      user.status,
      user.kycStatus,
      user.emailVerifiedAt,
      user.failedLoginAttempts,
      user.lockedUntil,
      user.isMfaEnabled,
      user.mfaSecret,
      user.passwordChangedAt,
      user.createdAt,
      user.updatedAt,
    ]);
  }

  private mapToEntity(row: UserRow): User {
    return new User({
      id: row.id,
      email: new Email(row.email),
      passwordHash: PasswordHash.fromExisting(row.password_hash),
      firstName: row.first_name,
      lastName: row.last_name,
      taxId: row.tax_id,
      status: row.status as UserLifecycleStatus,
      kycStatus: row.kyc_status as KycVerificationStatus,
      emailVerifiedAt: row.email_verified_at,
      failedLoginAttempts: row.failed_login_attempts,
      lockedUntil: row.locked_until,
      isMfaEnabled: row.is_mfa_enabled,
      mfaSecret: row.mfa_secret,
      passwordChangedAt: row.password_changed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}
