/**
 * Comprehensive Executable Integration Test Suite: Ledger Core Invariants & Security
 * Verified against real PostgreSQL 18 via Testcontainers.
 * Validates:
 * 1. Role-based least privilege: Direct table writes forbidden for spbk_app.
 * 2. Real immutability: Updates, deletions, and post-commit appends rejected.
 * 3. Zero-sum and line-count invariants enforced by deferred constraint trigger.
 * 4. Atomic authorized transfer via fn_post_transfer (SECURITY DEFINER).
 * 5. Double-spending prevention under concurrent execution.
 * 6. Audit balance reconciliation: Zero discrepancy between materialized balances and history.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

describe('Ledger Core Engine Invariants (PostgreSQL 18 Real Testcontainers)', () => {
  let container: StartedPostgreSqlContainer;
  let adminPool: pg.Pool;
  let appPool: pg.Pool;

  const bankAssetAccountId = '00000000-0000-0000-0000-000000001101';
  const testSourceAccountId = '11111111-1111-1111-1111-111111111111';
  const testDestAccountId = '22222222-2222-2222-2222-222222222222';

  beforeAll(async () => {
    // 1. Spin up ephemeral PostgreSQL 18 container
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('saintpatrickbk_experimental')
      .withUsername('spbk_admin')
      .withPassword('admin_secret_123')
      .start();

    adminPool = new pg.Pool({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
    });

    // 2. Execute experimental DDL as spbk_admin
    const ddlPath = path.resolve(__dirname, '../ddl.sql');
    const ddlContent = fs.readFileSync(ddlPath, 'utf-8');
    await adminPool.query(ddlContent);

    // 3. Create restricted role spbk_app and configure permissions
    await adminPool.query(`
      DO $$
      BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'spbk_app') THEN
              CREATE ROLE spbk_app WITH LOGIN PASSWORD 'app_secret_123';
          END IF;
      END
      $$;

      GRANT USAGE ON SCHEMA ledger TO spbk_app;
      GRANT SELECT ON ALL TABLES IN SCHEMA ledger TO spbk_app;
      
      -- Revoke all direct writes from application role
      REVOKE INSERT, UPDATE, DELETE ON ledger.journal_entries FROM spbk_app;
      REVOKE INSERT, UPDATE, DELETE ON ledger.journal_lines FROM spbk_app;
      REVOKE INSERT, UPDATE, DELETE ON ledger.account_balances FROM spbk_app;
      REVOKE INSERT, UPDATE, DELETE ON ledger.ledger_accounts FROM spbk_app;
      REVOKE INSERT, UPDATE, DELETE ON ledger.financial_operations FROM spbk_app;
      
      -- Grant execute strictly on authorized transactional stored procedure
      GRANT EXECUTE ON FUNCTION ledger.fn_post_transfer TO spbk_app;
      GRANT EXECUTE ON FUNCTION ledger.fn_audit_reconcile_balances TO spbk_app;
    `);

    // 4. Initialize client pool running strictly as spbk_app
    appPool = new pg.Pool({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: 'spbk_app',
      password: 'app_secret_123',
    });

    // 5. Seed test accounts as admin
    await adminPool.query(`
      INSERT INTO ledger.ledger_accounts (id, code, name, account_class, normal_balance, currency)
      VALUES 
        ('${bankAssetAccountId}', '1101', 'Commercial Bank Sight Account', 'ASSET', 'DEBIT', 'ARS'),
        ('${testSourceAccountId}', '2101:User:Alice', 'Alice Stored Value', 'LIABILITY', 'CREDIT', 'ARS'),
        ('${testDestAccountId}', '2101:User:Bob', 'Bob Stored Value', 'LIABILITY', 'CREDIT', 'ARS');

      INSERT INTO ledger.account_balances (account_id, cleared_balance_cents, available_balance_cents, currency)
      VALUES 
        ('${bankAssetAccountId}', 1000000, 1000000, 'ARS'),
        ('${testSourceAccountId}', 1000000, 1000000, 'ARS'), -- $10,000.00 ARS
        ('${testDestAccountId}', 0, 0, 'ARS');

      -- Seed historical journal entry funding Alice's initial balance to guarantee audit fidelity
      INSERT INTO ledger.financial_operations (id, client_reference_id, operation_type, status, amount_cents)
      VALUES ('99999999-9999-9999-9999-999999999999', 'init_seed_op', 'CASH_IN', 'CONFIRMED', 1000000);

      INSERT INTO ledger.journal_entries (id, financial_operation_id, idempotency_key, entry_type, description, is_locked)
      VALUES ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999', 'init_seed_idemp', 'SEED', 'Initial cash in', FALSE);

      INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents)
      VALUES 
        ('88888888-8888-8888-8888-888888888888', '${bankAssetAccountId}', 1, 'DEBIT', 1000000),
        ('88888888-8888-8888-8888-888888888888', '${testSourceAccountId}', 2, 'CREDIT', 1000000);
    `);
  }, 60000);

  afterAll(async () => {
    if (appPool) await appPool.end();
    if (adminPool) await adminPool.end();
    if (container) await container.stop();
  }, 30000);

  // ---------------------------------------------------------------------------
  // Suite 1: Role-Based Least Privilege & Direct Write Rejection
  // ---------------------------------------------------------------------------
  describe('Role-Based Least Privilege (spbk_app direct write rejection)', () => {
    it('should reject direct UPDATE on account_balances by spbk_app with 42501 permission denied', async () => {
      await expect(
        appPool.query(`UPDATE ledger.account_balances SET available_balance_cents = 99999999 WHERE account_id = '${testSourceAccountId}'`)
      ).rejects.toThrow(/permission denied/i);
    });

    it('should reject direct INSERT into journal_entries by spbk_app with 42501 permission denied', async () => {
      await expect(
        appPool.query(`
          INSERT INTO ledger.journal_entries (financial_operation_id, idempotency_key, entry_type, description)
          VALUES (gen_random_uuid(), 'illegal_key', 'HACK', 'Unauthorized direct entry')
        `)
      ).rejects.toThrow(/permission denied/i);
    });

    it('should reject direct INSERT into journal_lines by spbk_app with 42501 permission denied', async () => {
      await expect(
        appPool.query(`
          INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents)
          VALUES (gen_random_uuid(), '${testSourceAccountId}', 1, 'CREDIT', 100000)
        `)
      ).rejects.toThrow(/permission denied/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 2: Mathematical Zero-Sum & Dual-Leg Invariants
  // ---------------------------------------------------------------------------
  describe('Mathematical Invariants Enforcement (Deferred Constraint Trigger)', () => {
    it('should physically reject unbalanced entry (net delta != 0) at COMMIT time', async () => {
      const client = await adminPool.connect();
      try {
        await client.query('BEGIN');
        
        const opRes = await client.query(`
          INSERT INTO ledger.financial_operations (client_reference_id, operation_type, amount_cents)
          VALUES ('unbalanced_ref_1', 'TEST', 1000) RETURNING id;
        `);
        const opId = opRes.rows[0].id;

        const entryRes = await client.query(`
          INSERT INTO ledger.journal_entries (financial_operation_id, idempotency_key, entry_type, description)
          VALUES ('${opId}', 'unbalanced_idemp_1', 'TEST', 'Unbalanced test') RETURNING id;
        `);
        const entryId = entryRes.rows[0].id;

        // Debit 1000, Credit only 999 -> Net delta: +1 centavo
        await client.query(`
          INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents)
          VALUES 
            ('${entryId}', '${testSourceAccountId}', 1, 'DEBIT', 1000),
            ('${entryId}', '${testDestAccountId}', 2, 'CREDIT', 999);
        `);

        // Trigger executes at COMMIT and must raise exception
        await expect(client.query('COMMIT')).rejects.toThrow(/INV-02 VIOLATION.*does not balance to zero/i);
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    });

    it('should physically reject single-line entry (INV-01: minimum 2 lines)', async () => {
      const client = await adminPool.connect();
      try {
        await client.query('BEGIN');

        const opRes = await client.query(`
          INSERT INTO ledger.financial_operations (client_reference_id, operation_type, amount_cents)
          VALUES ('single_line_ref_1', 'TEST', 1000) RETURNING id;
        `);
        const opId = opRes.rows[0].id;

        const entryRes = await client.query(`
          INSERT INTO ledger.journal_entries (financial_operation_id, idempotency_key, entry_type, description)
          VALUES ('${opId}', 'single_line_idemp_1', 'TEST', 'Single line test') RETURNING id;
        `);
        const entryId = entryRes.rows[0].id;

        await client.query(`
          INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents)
          VALUES ('${entryId}', '${testSourceAccountId}', 1, 'DEBIT', 1000);
        `);

        await expect(client.query('COMMIT')).rejects.toThrow(/INV-01 VIOLATION.*Minimum 2 lines required/i);
      } finally {
        await client.query('ROLLBACK').catch(() => {});
        client.release();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 3: Real Immutability & Post-Commit Append Guard
  // ---------------------------------------------------------------------------
  describe('Real Immutability & Append Rejection', () => {
    let committedEntryId: string;

    beforeAll(async () => {
      // Execute an authorized transfer to obtain a committed entry
      const res = await appPool.query(`
        SELECT * FROM ledger.fn_post_transfer(
          'commit_immutability_ref',
          'commit_immutability_key',
          '${testSourceAccountId}',
          '${testDestAccountId}',
          10000, -- $100.00 ARS
          'ARS',
          'Immutability test transfer'
        );
      `);
      committedEntryId = res.rows[0].out_journal_entry_id;
    });

    it('should reject UPDATE on committed journal_entries even when executed by admin', async () => {
      await expect(
        adminPool.query(`UPDATE ledger.journal_entries SET description = 'Tampered' WHERE id = '${committedEntryId}'`)
      ).rejects.toThrow(/INV-05 VIOLATION.*strictly immutable/i);
    });

    it('should reject DELETE on committed journal_lines', async () => {
      await expect(
        adminPool.query(`DELETE FROM ledger.journal_lines WHERE journal_entry_id = '${committedEntryId}'`)
      ).rejects.toThrow(/INV-05 VIOLATION.*strictly immutable/i);
    });

    it('should reject appending new lines to an already committed/locked entry (INV-05 Append Guard)', async () => {
      await expect(
        adminPool.query(`
          INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents)
          VALUES ('${committedEntryId}', '${testSourceAccountId}', 3, 'DEBIT', 5000);
        `)
      ).rejects.toThrow(/INV-05 VIOLATION.*Cannot append new journal lines.*already locked and posted/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 4: Authorized Transfer Execution via fn_post_transfer
  // ---------------------------------------------------------------------------
  describe('Atomic Authorized Execution via fn_post_transfer', () => {
    it('should execute transfer atomically and update balances + outbox event', async () => {
      const amount = 25000n; // $250.00 ARS
      const clientRef = 'p2p_tx_success_1';
      const idempKey = 'idemp_key_success_1';

      const res = await appPool.query(`
        SELECT * FROM ledger.fn_post_transfer(
          '${clientRef}',
          '${idempKey}',
          '${testSourceAccountId}',
          '${testDestAccountId}',
          ${amount},
          'ARS',
          'P2P Payment from Alice to Bob'
        );
      `);

      expect(res.rows.length).toBe(1);
      const row = res.rows[0];
      expect(row.out_operation_id).toBeDefined();
      expect(row.out_journal_entry_id).toBeDefined();

      // Verify Outbox Event was written in the same transaction
      const outboxRes = await appPool.query(`
        SELECT * FROM ledger.outbox_events WHERE aggregate_id = '${row.out_operation_id}'
      `);
      expect(outboxRes.rows.length).toBe(1);
      expect(outboxRes.rows[0].event_type).toBe('TransferCompletedEvent');
      expect(outboxRes.rows[0].status).toBe('PENDING');
    });

    it('should reject transfer when available balance is insufficient (55000)', async () => {
      const exorbitantAmount = 999999999n;

      await expect(
        appPool.query(`
          SELECT * FROM ledger.fn_post_transfer(
            'p2p_insufficient_ref',
            'p2p_insufficient_key',
            '${testSourceAccountId}',
            '${testDestAccountId}',
            ${exorbitantAmount},
            'ARS',
            'Overdraft attempt'
          );
        `)
      ).rejects.toThrow(/INSUFFICIENT_FUNDS/i);
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 5: Anti-Double-Spending Under Concurrent Load
  // ---------------------------------------------------------------------------
  describe('Double-Spending Prevention under Concurrency', () => {
    it('should permit exactly one transaction and reject concurrent contenders when funds are limited', async () => {
      // 1. Create a fresh account with exactly $500.00 ARS (50000 cents)
      const freshSourceId = '33333333-3333-3333-3333-333333333333';
      const freshDestId = '44444444-4444-4444-4444-444444444444';

      await adminPool.query(`
        INSERT INTO ledger.ledger_accounts (id, code, name, account_class, normal_balance, currency)
        VALUES 
          ('${freshSourceId}', '2101:User:Charlie', 'Charlie Stored Value', 'LIABILITY', 'CREDIT', 'ARS'),
          ('${freshDestId}', '2101:User:Dave', 'Dave Stored Value', 'LIABILITY', 'CREDIT', 'ARS');

        INSERT INTO ledger.account_balances (account_id, cleared_balance_cents, available_balance_cents, currency)
        VALUES 
          ('${freshSourceId}', 50000, 50000, 'ARS'),
          ('${freshDestId}', 0, 0, 'ARS');

        -- Seed balanced journal entry for Charlie to maintain audit reconciliation
        INSERT INTO ledger.financial_operations (id, client_reference_id, operation_type, status, amount_cents)
        VALUES ('77777777-7777-7777-7777-777777777777', 'seed_charlie_ref', 'CASH_IN', 'CONFIRMED', 50000);

        INSERT INTO ledger.journal_entries (id, financial_operation_id, idempotency_key, entry_type, description, is_locked)
        VALUES ('66666666-6666-6666-6666-666666666666', '77777777-7777-7777-7777-777777777777', 'seed_charlie_idemp', 'SEED', 'Charlie seed', FALSE);

        INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents)
        VALUES 
          ('66666666-6666-6666-6666-666666666666', '${bankAssetAccountId}', 1, 'DEBIT', 50000),
          ('66666666-6666-6666-6666-666666666666', '${freshSourceId}', 2, 'CREDIT', 50000);

        -- Update bank asset balance accordingly
        UPDATE ledger.account_balances 
        SET cleared_balance_cents = cleared_balance_cents + 50000, available_balance_cents = available_balance_cents + 50000
        WHERE account_id = '${bankAssetAccountId}';
      `);

      // 2. Launch 8 concurrent transfers of $500.00 each from Charlie to Dave
      const transferAttempts = Array.from({ length: 8 }, (_, idx) => {
        return appPool.query(`
          SELECT * FROM ledger.fn_post_transfer(
            'concurrent_ref_${idx}',
            'concurrent_key_${idx}',
            '${freshSourceId}',
            '${freshDestId}',
            50000, -- Entire balance!
            'ARS',
            'Concurrent race condition test'
          );
        `).then(() => ({ success: true }))
          .catch((err: Error) => ({ success: false, error: err.message }));
      });

      const results = await Promise.all(transferAttempts);

      const successCount = results.filter((r) => r.success).length;
      const failureCount = results.filter((r) => !r.success).length;

      // Exactly 1 must succeed; 7 must fail with INSUFFICIENT_FUNDS
      expect(successCount).toBe(1);
      expect(failureCount).toBe(7);

      // Verify balance is exactly 0 and never went negative
      const balanceCheck = await appPool.query(`
        SELECT available_balance_cents, cleared_balance_cents 
        FROM ledger.account_balances WHERE account_id = '${freshSourceId}';
      `);
      expect(balanceCheck.rows[0].available_balance_cents).toBe('0');
      expect(balanceCheck.rows[0].cleared_balance_cents).toBe('0');
    });
  });

  // ---------------------------------------------------------------------------
  // Suite 6: Audit Reconciliation (Zero Discrepancy Verification)
  // ---------------------------------------------------------------------------
  describe('Independent Audit Reconciliation', () => {
    it('should detect zero discrepancy between materialized balances and history', async () => {
      const auditRes = await appPool.query('SELECT * FROM ledger.fn_audit_reconcile_balances();');
      
      // Zero rows returned means 100% of accounts have 0 discrepancy between materialized balance and SUM(lines)
      expect(auditRes.rows.length).toBe(0);
    });
  });
});
