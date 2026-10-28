import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runMigrations } from '../migrations/runner';

describe('Ledger Invariants, Zero-Sum, and Locking Guards (PostgreSQL 18)', () => {
  let container: StartedPostgreSqlContainer;
  let adminPool: pg.Pool;

  const testOpId = '11111111-1111-1111-1111-111111111111';
  const accountArsA = '22222222-2222-2222-2222-222222222222';
  const accountArsB = '33333333-3333-3333-3333-333333333333';
  const accountUsdA = '44444444-4444-4444-4444-444444444444';

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

    await runMigrations(adminPool);

    // Seed test accounts (ARS and USD)
    await adminPool.query(`
      INSERT INTO ledger.ledger_accounts (id, code, name, account_class, normal_balance, currency)
      VALUES 
        ('${accountArsA}', '2101:Alice:ARS', 'Alice ARS', 'LIABILITY', 'CREDIT', 'ARS'),
        ('${accountArsB}', '2101:Bob:ARS', 'Bob ARS', 'LIABILITY', 'CREDIT', 'ARS'),
        ('${accountUsdA}', '2101:Alice:USD', 'Alice USD', 'LIABILITY', 'CREDIT', 'USD');

      INSERT INTO ledger.account_balances (account_id, cleared_balance_cents, available_balance_cents, currency)
      VALUES 
        ('${accountArsA}', 500000, 500000, 'ARS'),
        ('${accountArsB}', 0, 0, 'ARS'),
        ('${accountUsdA}', 10000, 10000, 'USD');

      INSERT INTO ledger.financial_operations (id, client_reference_id, request_hash, operation_type, status, amount_cents, currency)
      VALUES ('${testOpId}', 'test_op_ref_1', '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', 'MANUAL_TEST', 'CONFIRMED', 100000, 'ARS');
    `);
  }, 90000);

  afterAll(async () => {
    if (adminPool) await adminPool.end();
    if (container) await container.stop();
  }, 60000);

  it('should physically reject an empty journal entry (0 lines) at COMMIT time', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN;');
      await client.query(`
        INSERT INTO ledger.journal_entries (id, financial_operation_id, idempotency_key, entry_type, description, is_locked)
        VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '${testOpId}', 'empty_entry_key', 'EMPTY_TEST', 'Zero lines entry', FALSE);
      `);
      // Attempting to commit without inserting any lines must fail
      await expect(client.query('COMMIT;')).rejects.toThrow(/INV-01 VIOLATION: Journal Entry .* has 0 lines/i);
    } finally {
      client.release();
    }
  });

  it('should physically reject a single-line journal entry at COMMIT time', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN;');
      await client.query(`
        INSERT INTO ledger.journal_entries (id, financial_operation_id, idempotency_key, entry_type, description, is_locked)
        VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '${testOpId}', 'single_line_key', 'SINGLE_TEST', 'One line entry', FALSE);
      `);
      await client.query(`
        INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
        VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '${accountArsA}', 1, 'DEBIT', 10000, 'ARS');
      `);
      await expect(client.query('COMMIT;')).rejects.toThrow(/INV-01 VIOLATION: Journal Entry .* has only 1 line/i);
    } finally {
      client.release();
    }
  });

  it('should physically reject an unbalanced single-currency entry at COMMIT time', async () => {
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN;');
      await client.query(`
        INSERT INTO ledger.journal_entries (id, financial_operation_id, idempotency_key, entry_type, description, is_locked)
        VALUES ('cccccccc-cccc-cccc-cccc-cccccccccccc', '${testOpId}', 'unbalanced_key', 'UNBALANCED', 'Unbalanced delta', FALSE);
      `);
      await client.query(`
        INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
        VALUES 
          ('cccccccc-cccc-cccc-cccc-cccccccccccc', '${accountArsA}', 1, 'DEBIT', 10000, 'ARS'),
          ('cccccccc-cccc-cccc-cccc-cccccccccccc', '${accountArsB}', 2, 'CREDIT', 9000, 'ARS');
      `);
      await expect(client.query('COMMIT;')).rejects.toThrow(/INV-02 VIOLATION/i);
    } finally {
      client.release();
    }
  });

  it('should physically reject multi-currency entry where net sum is zero but per-currency unbalanced', async () => {
    // USD line (+10000) and ARS line (-10000) sum to 0 numerically, but each currency has a non-zero balance!
    const client = await adminPool.connect();
    try {
      await client.query('BEGIN;');
      await client.query(`
        INSERT INTO ledger.journal_entries (id, financial_operation_id, idempotency_key, entry_type, description, is_locked)
        VALUES ('dddddddd-dddd-dddd-dddd-dddddddddddd', '${testOpId}', 'currency_imbalance_key', 'CROSS_CURRENCY', 'Cross currency delta', FALSE);
      `);
      await client.query(`
        INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
        VALUES 
          ('dddddddd-dddd-dddd-dddd-dddddddddddd', '${accountUsdA}', 1, 'DEBIT', 10000, 'USD'),
          ('dddddddd-dddd-dddd-dddd-dddddddddddd', '${accountArsB}', 2, 'CREDIT', 10000, 'ARS');
      `);
      await expect(client.query('COMMIT;')).rejects.toThrow(/INV-02 VIOLATION: Journal Entry .* is unbalanced per currency/i);
    } finally {
      client.release();
    }
  });

  it('should physically reject line currency mismatching account currency (INV-04)', async () => {
    // accountArsA expects ARS, inserting USD must fail before insert
    await expect(
      adminPool.query(`
        INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
        VALUES (gen_random_uuid(), '${accountArsA}', 1, 'DEBIT', 10000, 'USD')
      `)
    ).rejects.toThrow(/INV-04 VIOLATION: Currency mismatch. Line currency USD does not match account currency ARS/i);
  });

  it('should physically reject non-positive amounts (amount <= 0)', async () => {
    await expect(
      adminPool.query(`
        INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
        VALUES (gen_random_uuid(), '${accountArsA}', 1, 'DEBIT', 0, 'ARS')
      `)
    ).rejects.toThrow(/chk_positive_amount|check constraint/i);
  });

  it('should commit a valid balanced entry, lock it, and reject post-commit appends (INV-05 Append Guard)', async () => {
    const validEntryId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const client = await adminPool.connect();

    // 1. Commit valid entry with 2 balanced lines
    await client.query('BEGIN;');
    await client.query(`
      INSERT INTO ledger.journal_entries (id, financial_operation_id, idempotency_key, entry_type, description, is_locked)
      VALUES ('${validEntryId}', '${testOpId}', 'valid_committed_key', 'VALID_ENTRY', 'Legitimate balanced entry', FALSE);
    `);
    await client.query(`
      INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
      VALUES 
        ('${validEntryId}', '${accountArsA}', 1, 'DEBIT', 5000, 'ARS'),
        ('${validEntryId}', '${accountArsB}', 2, 'CREDIT', 5000, 'ARS');
    `);
    await client.query('COMMIT;');
    client.release();

    // Verify entry is locked
    const res = await adminPool.query(`SELECT is_locked FROM ledger.journal_entries WHERE id = '${validEntryId}'`);
    expect(res.rows[0].is_locked).toBe(true);

    // 2. Attempt post-commit append: try to add line 3 to the committed entry
    await expect(
      adminPool.query(`
        INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
        VALUES ('${validEntryId}', '${accountArsA}', 3, 'DEBIT', 1000, 'ARS')
      `)
    ).rejects.toThrow(/INV-05 VIOLATION: Cannot append new journal lines to entry .* Entry is already locked and committed/i);
  });

  it('should reject UPDATE and DELETE on committed journal entries and lines (Real Immutability)', async () => {
    const validEntryId = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

    // Cannot UPDATE entry
    await expect(
      adminPool.query(`UPDATE ledger.journal_entries SET description = 'Tampered' WHERE id = '${validEntryId}'`)
    ).rejects.toThrow(/INV-05 VIOLATION: Journal entries are immutable/i);

    // Cannot revert is_locked from TRUE to FALSE
    await expect(
      adminPool.query(`UPDATE ledger.journal_entries SET is_locked = FALSE WHERE id = '${validEntryId}'`)
    ).rejects.toThrow(/INV-05 VIOLATION: Journal entries are immutable/i);

    // Cannot DELETE line
    await expect(
      adminPool.query(`DELETE FROM ledger.journal_lines WHERE journal_entry_id = '${validEntryId}'`)
    ).rejects.toThrow(/INV-05 VIOLATION: Journal lines are strictly immutable/i);
  });

  it('should prove that the internal is_locked transition cannot be abused to modify other fields', async () => {
    const probeEntryId = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
    const client = await adminPool.connect();

    // 1. Insert an entry with is_locked = FALSE (deferred trigger will verify on COMMIT)
    await client.query('BEGIN;');
    await client.query(`
      INSERT INTO ledger.journal_entries (id, financial_operation_id, idempotency_key, entry_type, description, is_locked)
      VALUES ('${probeEntryId}', '${testOpId}', 'probe_transition_key', 'PROBE', 'Original description', FALSE);
    `);
    await client.query(`
      INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
      VALUES 
        ('${probeEntryId}', '${accountArsA}', 1, 'DEBIT', 2000, 'ARS'),
        ('${probeEntryId}', '${accountArsB}', 2, 'CREDIT', 2000, 'ARS');
    `);

    // 2. Attempt malicious UPDATE inside transaction: set is_locked = TRUE while altering description
    await client.query('SAVEPOINT sp_desc;');
    await expect(
      client.query(`
        UPDATE ledger.journal_entries 
        SET is_locked = TRUE, description = 'Tampered description via lock bypass' 
        WHERE id = '${probeEntryId}'
      `)
    ).rejects.toThrow(/INV-05 VIOLATION: Journal entries are immutable/i);
    await client.query('ROLLBACK TO SAVEPOINT sp_desc;');

    // 3. Attempt malicious UPDATE inside transaction: set is_locked = TRUE while altering idempotency_key
    await client.query('SAVEPOINT sp_key;');
    await expect(
      client.query(`
        UPDATE ledger.journal_entries 
        SET is_locked = TRUE, idempotency_key = 'hacked_key' 
        WHERE id = '${probeEntryId}'
      `)
    ).rejects.toThrow(/INV-05 VIOLATION: Journal entries are immutable/i);
    await client.query('ROLLBACK TO SAVEPOINT sp_key;');

    // 4. Commit legitimately (deferred trigger sets is_locked = TRUE safely without modifying other fields)
    await client.query('COMMIT;');
    client.release();

    const verified = await adminPool.query(`SELECT description, idempotency_key, is_locked FROM ledger.journal_entries WHERE id = '${probeEntryId}'`);
    expect(verified.rows[0].description).toBe('Original description');
    expect(verified.rows[0].idempotency_key).toBe('probe_transition_key');
    expect(verified.rows[0].is_locked).toBe(true);

    // 5. Once locked, even setting is_locked = TRUE with identical fields is rejected
    await expect(
      adminPool.query(`UPDATE ledger.journal_entries SET is_locked = TRUE WHERE id = '${probeEntryId}'`)
    ).rejects.toThrow(/INV-05 VIOLATION: Journal entries are immutable/i);
  });
});

