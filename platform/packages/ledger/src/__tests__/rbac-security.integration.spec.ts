import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runMigrations } from '../migrations/runner';

describe('RBAC Security & Minimal Privilege Architecture (PostgreSQL 18)', () => {
  let container: StartedPostgreSqlContainer;
  let adminPool: pg.Pool;
  let appPool: pg.Pool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('saintpatrickbk_test')
      .withUsername('spbk_admin')
      .withPassword('admin_secret')
      .start();

    adminPool = new pg.Pool({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: 'spbk_admin',
      password: 'admin_secret',
    });

    // Run versioned migrations 001 - 005 sequentially
    await runMigrations(adminPool);

    // Runtime application pool running strictly as spbk_app
    appPool = new pg.Pool({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: 'spbk_app',
      password: 'spbk_app_dev_secret',
    });
  }, 90000);

  afterAll(async () => {
    if (appPool) await appPool.end();
    if (adminPool) await adminPool.end();
    if (container) await container.stop();
  }, 30000);

  it('should verify spbk_ledger_owner is NOT superuser, cannot create DB, cannot create role', async () => {
    const res = await adminPool.query(`
      SELECT rolname, rolsuper, rolcreaterole, rolcreatedb
      FROM pg_roles
      WHERE rolname = 'spbk_ledger_owner';
    `);

    expect(res.rows).toHaveLength(1);
    const owner = res.rows[0];
    expect(owner.rolsuper).toBe(false);
    expect(owner.rolcreaterole).toBe(false);
    expect(owner.rolcreatedb).toBe(false);
  });

  it('should verify PUBLIC has NO execute privileges on financial functions', async () => {
    const functions = [
      'fn_post_transfer',
      'fn_create_reservation',
      'fn_settle_reservation',
      'fn_release_reservation',
      'fn_post_reversal',
      'fn_audit_reconcile_balances',
    ];

    for (const fn of functions) {
      const res = await adminPool.query(
        `SELECT has_function_privilege('public', p.oid, 'EXECUTE') AS has_priv
         FROM pg_proc p 
         JOIN pg_namespace n ON n.oid = p.pronamespace 
         WHERE n.nspname = 'ledger' AND p.proname = $1;`,
        [fn]
      );
      expect(res.rows[0].has_priv).toBe(false);
    }
  });

  it('should verify spbk_app HAS execute privileges on financial functions', async () => {
    const functions = [
      'fn_post_transfer',
      'fn_create_reservation',
      'fn_settle_reservation',
      'fn_release_reservation',
      'fn_post_reversal',
      'fn_audit_reconcile_balances',
    ];

    for (const fn of functions) {
      const res = await adminPool.query(
        `SELECT has_function_privilege('spbk_app', p.oid, 'EXECUTE') AS has_priv
         FROM pg_proc p 
         JOIN pg_namespace n ON n.oid = p.pronamespace 
         WHERE n.nspname = 'ledger' AND p.proname = $1;`,
        [fn]
      );
      expect(res.rows[0].has_priv).toBe(true);
    }
  });

  it('should reject object creation in schema ledger by spbk_app (CREATE privilege revoked)', async () => {
    await expect(
      appPool.query(`CREATE TABLE ledger.malicious_tamper (id INT);`)
    ).rejects.toThrow(/permission denied for schema ledger/i);
  });

  it('should reject direct UPDATE on account_balances by spbk_app with 42501 permission denied', async () => {
    await expect(
      appPool.query(`UPDATE ledger.account_balances SET available_balance_cents = 99999999`)
    ).rejects.toThrow(/permission denied for table account_balances/i);
  });

  it('should reject direct INSERT into journal_entries by spbk_app with 42501 permission denied', async () => {
    await expect(
      appPool.query(`
        INSERT INTO ledger.journal_entries (financial_operation_id, idempotency_key, entry_type, description)
        VALUES (gen_random_uuid(), 'illegal_key', 'TAMPER', 'Direct uncoordinated insert')
      `)
    ).rejects.toThrow(/permission denied for table journal_entries/i);
  });

  it('should reject direct INSERT into journal_lines by spbk_app with 42501 permission denied', async () => {
    await expect(
      appPool.query(`
        INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents)
        VALUES (gen_random_uuid(), gen_random_uuid(), 1, 'CREDIT', 100000)
      `)
    ).rejects.toThrow(/permission denied for table journal_lines/i);
  });

  it('should reject direct INSERT into funds_reservations by spbk_app with 42501 permission denied', async () => {
    await expect(
      appPool.query(`
        INSERT INTO ledger.funds_reservations (operation_id, account_id, reserved_account_id, amount_cents, currency, status, creation_journal_entry_id, expires_at)
        VALUES (gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), 1000, 'ARS', 'ACTIVE', gen_random_uuid(), NOW() + INTERVAL '1 hour')
      `)
    ).rejects.toThrow(/permission denied for table funds_reservations/i);
  });

  it('should reject direct DELETE on ledger_accounts by spbk_app with 42501 permission denied', async () => {
    await expect(
      appPool.query(`DELETE FROM ledger.ledger_accounts`)
    ).rejects.toThrow(/permission denied for table ledger_accounts/i);
  });

  it('should allow SELECT on ledger tables by spbk_app', async () => {
    const res = await appPool.query(`SELECT COUNT(*) FROM ledger.ledger_accounts;`);
    expect(res.rows).toHaveLength(1);
    expect(Number(res.rows[0].count)).toBeGreaterThanOrEqual(0);
  });
});
