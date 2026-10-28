import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { Money } from '@spbk/shared-kernel';
import { runMigrations } from '../migrations/runner';
import { PostgresLedgerRepository } from '../infrastructure/repositories/postgres-ledger.repository';
import { PostgresFundsReservationRepository } from '../infrastructure/repositories/postgres-funds-reservation.repository';
import { PostTransferUseCase } from '../application/use-cases/post-transfer.use-case';
import { CreateReservationUseCase } from '../application/use-cases/create-reservation.use-case';

describe('Concurrency Control, Anti-Double-Spending, and Persistent Idempotency', () => {
  let container: StartedPostgreSqlContainer;
  let adminPool: pg.Pool;
  let appPool: pg.Pool;

  let ledgerRepo: PostgresLedgerRepository;
  let resRepo: PostgresFundsReservationRepository;
  let postTransferUseCase: PostTransferUseCase;
  let createResUseCase: CreateReservationUseCase;

  const charlieAccountId = 'cccccccc-0000-0000-0000-000000000001';
  const charlieReservedId = 'cccccccc-0000-0000-0000-000000000002';
  const daveAccountId = 'dddddddd-0000-0000-0000-000000000001';

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

    // Seed test accounts: Charlie has $10,000.00 ARS (1,000,000 cents), Dave has $0.00
    await adminPool.query(`
      INSERT INTO ledger.ledger_accounts (id, code, name, account_class, normal_balance, currency)
      VALUES 
        ('${charlieAccountId}', '2101:Charlie:Available', 'Charlie Available', 'LIABILITY', 'CREDIT', 'ARS'),
        ('${charlieReservedId}', '2102:Charlie:Reserved', 'Charlie Reserved', 'LIABILITY', 'CREDIT', 'ARS'),
        ('${daveAccountId}', '2101:Dave:Available', 'Dave Available', 'LIABILITY', 'CREDIT', 'ARS');

      INSERT INTO ledger.account_balances (account_id, cleared_balance_cents, reserved_balance_cents, available_balance_cents, currency)
      VALUES 
        ('${charlieAccountId}', 1000000, 0, 1000000, 'ARS'),
        ('${charlieReservedId}', 0, 0, 0, 'ARS'),
        ('${daveAccountId}', 0, 0, 0, 'ARS');
    `);

    appPool = new pg.Pool({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: 'spbk_app',
      password: 'spbk_app_dev_secret',
      max: 20, // generous connection pool for concurrent tests
    });

    ledgerRepo = new PostgresLedgerRepository(appPool);
    resRepo = new PostgresFundsReservationRepository(appPool);
    postTransferUseCase = new PostTransferUseCase(ledgerRepo);
    createResUseCase = new CreateReservationUseCase(resRepo);
  }, 90000);

  afterAll(async () => {
    if (appPool) await appPool.end();
    if (adminPool) await adminPool.end();
    if (container) await container.stop();
  }, 30000);

  it('should physically prevent double-spending when 10 concurrent requests contest limited funds', async () => {
    // Charlie has $10,000.00 (1,000,000 cents).
    // Launch 10 simultaneous transfer attempts of $10,000.00 each.
    const promises = Array.from({ length: 10 }).map((_, index) =>
      postTransferUseCase.execute({
        clientReferenceId: `concurrent_transfer_ref_${index}`,
        idempotencyKey: `idemp_concurrent_key_${index}`,
        sourceAccountId: charlieAccountId,
        destAccountId: daveAccountId,
        amount: Money.fromCents(1000000n, 'ARS'),
        description: `Concurrent attempt ${index}`,
      })
    );

    const results = await Promise.allSettled(promises);
    const successful = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    // Exactly 1 must succeed; exactly 9 must be rejected with INSUFFICIENT_FUNDS
    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(9);

    for (const rej of rejected) {
      if (rej.status === 'rejected') {
        expect(rej.reason.message).toMatch(/INSUFFICIENT_FUNDS/i);
      }
    }

    // Charlie's balance must be strictly 0; Dave's balance must be strictly $10,000.00
    const charlieBal = await ledgerRepo.getBalance(charlieAccountId);
    const daveBal = await ledgerRepo.getBalance(daveAccountId);

    expect(charlieBal?.availableBalance.amountCents).toBe(0n);
    expect(charlieBal?.clearedBalance.amountCents).toBe(0n);
    expect(daveBal?.availableBalance.amountCents).toBe(1000000n);
    expect(daveBal?.clearedBalance.amountCents).toBe(1000000n);
  });

  it('should prevent double reservation when 2 concurrent reservations exceed remaining funds', async () => {
    // Fund Charlie with $10,000.00 again for this test
    await adminPool.query(`
      UPDATE ledger.account_balances 
      SET available_balance_cents = 1000000, cleared_balance_cents = 1000000 
      WHERE account_id = '${charlieAccountId}';
    `);

    // Two concurrent reservations of $6,000.00 each (total $12,000 > $10,000)
    const p1 = createResUseCase.execute({
      clientReferenceId: 'concurrent_res_1',
      idempotencyKey: 'idemp_res_1',
      accountId: charlieAccountId,
      reservedAccountId: charlieReservedId,
      amount: Money.fromCents(600000n, 'ARS'),
      expiresAt: new Date(Date.now() + 3600000),
      description: 'Reservation A',
    });

    const p2 = createResUseCase.execute({
      clientReferenceId: 'concurrent_res_2',
      idempotencyKey: 'idemp_res_2',
      accountId: charlieAccountId,
      reservedAccountId: charlieReservedId,
      amount: Money.fromCents(600000n, 'ARS'),
      expiresAt: new Date(Date.now() + 3600000),
      description: 'Reservation B',
    });

    const results = await Promise.allSettled([p1, p2]);
    const successful = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const charlieBal = await ledgerRepo.getBalance(charlieAccountId);
    expect(charlieBal?.availableBalance.amountCents).toBe(400000n); // $4,000 left
    expect(charlieBal?.reservedBalance.amountCents).toBe(600000n);  // $6,000 reserved
  });

  it('should handle persistent idempotency: replay identical request safely without double debit', async () => {
    // Execute transfer
    const firstResult = await postTransferUseCase.execute({
      clientReferenceId: 'permanent_idemp_order_555',
      idempotencyKey: 'idemp_order_555_a',
      sourceAccountId: daveAccountId, // Dave currently has $10,000.00
      destAccountId: charlieAccountId,
      amount: Money.fromCents(200000n, 'ARS'),
      description: 'First attempt',
    });

    expect(firstResult.isIdempotentReplay).toBe(false);

    // Replay exact same request with same clientReferenceId and same payload parameters
    const secondResult = await postTransferUseCase.execute({
      clientReferenceId: 'permanent_idemp_order_555',
      idempotencyKey: 'idemp_order_555_b', // even with another HTTP transit key
      sourceAccountId: daveAccountId,
      destAccountId: charlieAccountId,
      amount: Money.fromCents(200000n, 'ARS'),
      description: 'First attempt',
    });

    expect(secondResult.isIdempotentReplay).toBe(true);
    expect(secondResult.operationId).toBe(firstResult.operationId);
    expect(secondResult.journalEntryId).toBe(firstResult.journalEntryId);

    // Dave should only have been debited ONCE ($2,000.00)
    const daveBal = await ledgerRepo.getBalance(daveAccountId);
    expect(daveBal?.availableBalance.amountCents).toBe(800000n);
  });

  it('should reject reusing an existing client_reference_id with different payload parameters (IDEMPOTENCY_CONFLICT)', async () => {
    // Attempt to reuse 'permanent_idemp_order_555' but with $9,999.00 amount
    await expect(
      postTransferUseCase.execute({
        clientReferenceId: 'permanent_idemp_order_555',
        idempotencyKey: 'idemp_order_555_c',
        sourceAccountId: daveAccountId,
        destAccountId: charlieAccountId,
        amount: Money.fromCents(999900n, 'ARS'), // Different amount!
        description: 'Tampered replay',
      })
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT/i);
  });

  it('should atomically persist Outbox events in the exact same transaction', async () => {
    const res = await appPool.query(`
      SELECT aggregate_type, aggregate_id, event_type, status, payload
      FROM ledger.outbox_events
      WHERE aggregate_type = 'TRANSFER'
      ORDER BY created_at DESC
      LIMIT 1;
    `);

    expect(res.rows).toHaveLength(1);
    const outboxRow = res.rows[0];
    expect(outboxRow.event_type).toBe('TransferCompletedEvent');
    expect(outboxRow.status).toBe('PENDING');
    expect(outboxRow.payload.amountCents).toBe('200000');
  });
});
