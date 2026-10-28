import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { Money } from '@spbk/shared-kernel';
import { runMigrations } from '../migrations/runner';
import { PostgresLedgerRepository } from '../infrastructure/repositories/postgres-ledger.repository';
import { PostgresFundsReservationRepository } from '../infrastructure/repositories/postgres-funds-reservation.repository';
import { CreateReservationUseCase } from '../application/use-cases/create-reservation.use-case';
import { SettleReservationUseCase } from '../application/use-cases/settle-reservation.use-case';
import { ReleaseReservationUseCase } from '../application/use-cases/release-reservation.use-case';

describe('Complete Funds Reservation Lifecycle (Strategy B Accounted Postings)', () => {
  let container: StartedPostgreSqlContainer;
  let adminPool: pg.Pool;
  let appPool: pg.Pool;

  let ledgerRepo: PostgresLedgerRepository;
  let resRepo: PostgresFundsReservationRepository;

  let createResUseCase: CreateReservationUseCase;
  let settleResUseCase: SettleReservationUseCase;
  let releaseResUseCase: ReleaseReservationUseCase;

  const bankAssetAccountId = '00000000-0000-0000-0000-000000000001';
  const aliceAvailableId = '00000000-0000-0000-0000-000000000002';
  const aliceReservedId = '00000000-0000-0000-0000-000000000003';

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

    // Seed Chart of Accounts
    await adminPool.query(`
      INSERT INTO ledger.ledger_accounts (id, code, name, account_class, normal_balance, currency)
      VALUES 
        ('${bankAssetAccountId}', '1101', 'Commercial Bank Sight Account', 'ASSET', 'DEBIT', 'ARS'),
        ('${aliceAvailableId}', '2101:Alice:Available', 'Alice Available Stored Value', 'LIABILITY', 'CREDIT', 'ARS'),
        ('${aliceReservedId}', '2102:Alice:Reserved', 'Alice In-Flight Reserved Liability', 'LIABILITY', 'CREDIT', 'ARS');

      INSERT INTO ledger.account_balances (account_id, cleared_balance_cents, reserved_balance_cents, available_balance_cents, currency)
      VALUES 
        ('${bankAssetAccountId}', 2000000, 0, 2000000, 'ARS'), -- $20,000.00 Bank Asset Backing
        ('${aliceAvailableId}', 2000000, 0, 2000000, 'ARS'),     -- $20,000.00 Alice Available
        ('${aliceReservedId}', 0, 0, 0, 'ARS');

      -- Seed initial cash-in historical journal entry to ensure 100% audit reconciliation
      INSERT INTO ledger.financial_operations (id, client_reference_id, request_hash, operation_type, status, amount_cents)
      VALUES ('99999999-9999-9999-9999-999999999999', 'init_cash_in', 'seed_hash', 'CASH_IN', 'CONFIRMED', 2000000);

      INSERT INTO ledger.journal_entries (id, financial_operation_id, idempotency_key, entry_type, description, is_locked)
      VALUES ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999', 'seed_idemp', 'SEED', 'Alice Seed', FALSE);

      INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
      VALUES 
        ('88888888-8888-8888-8888-888888888888', '${bankAssetAccountId}', 1, 'DEBIT', 2000000, 'ARS'),
        ('88888888-8888-8888-8888-888888888888', '${aliceAvailableId}', 2, 'CREDIT', 2000000, 'ARS');
    `);

    // Application Pool running strictly as spbk_app
    appPool = new pg.Pool({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: 'spbk_app',
      password: 'spbk_app_dev_secret',
    });

    ledgerRepo = new PostgresLedgerRepository(appPool);
    resRepo = new PostgresFundsReservationRepository(appPool);

    createResUseCase = new CreateReservationUseCase(resRepo);
    settleResUseCase = new SettleReservationUseCase(resRepo);
    releaseResUseCase = new ReleaseReservationUseCase(resRepo);
  }, 90000);

  afterAll(async () => {
    if (appPool) await appPool.end();
    if (adminPool) await adminPool.end();
    if (container) await container.stop();
  }, 30000);

  let firstReservationId: string;
  let secondReservationId: string;

  it('Scenario 1: should create a reservation, moving funds to transit account without reducing cleared balance', async () => {
    const res = await createResUseCase.execute({
      clientReferenceId: 'res_order_1001',
      idempotencyKey: 'idemp_order_1001',
      accountId: aliceAvailableId,
      reservedAccountId: aliceReservedId,
      amount: Money.fromCents(500000n, 'ARS'), // $5,000.00 ARS
      expiresAt: new Date(Date.now() + 3600000), // 1 hour
      description: 'Reservation for Outbound Debit $5,000.00',
    });

    expect(res.reservationId).toBeDefined();
    expect(res.isIdempotentReplay).toBe(false);
    firstReservationId = res.reservationId;

    // Verify Alice's balance:
    // Available was $20,000.00 -> now $15,000.00
    // Reserved was $0.00 -> now $5,000.00
    // Cleared stays $20,000.00 (funds remain with fintech custody until settlement)
    const aliceBal = await ledgerRepo.getBalance(aliceAvailableId);
    expect(aliceBal?.availableBalance.amountCents).toBe(1500000n);
    expect(aliceBal?.reservedBalance.amountCents).toBe(500000n);
    expect(aliceBal?.clearedBalance.amountCents).toBe(2000000n);

    // Verify Reservation record in DB
    const resRecord = await resRepo.getReservationById(res.reservationId);
    expect(resRecord?.status).toBe('ACTIVE');
    expect(resRecord?.amount.amountCents).toBe(500000n);
  });

  it('Scenario 2: should settle the reservation upon clearing confirmation, reducing customer cleared balance and bank asset', async () => {
    // Settle against bankAssetAccountId (funds leave fintech to external destination)
    const settleResult = await settleResUseCase.execute({
      reservationId: firstReservationId,
      clientReferenceId: 'settle_order_1001',
      idempotencyKey: 'idemp_settle_order_1001',
      destinationAccountId: bankAssetAccountId,
      settleAmount: Money.fromCents(500000n, 'ARS'),
      description: 'COELSA Clearing Settlement of $5,000.00',
    });

    expect(settleResult.operationId).toBeDefined();
    expect(settleResult.isIdempotentReplay).toBe(false);

    // Alice balances after settlement:
    // Available: $15,000.00
    // Reserved: $0.00 (cleared out)
    // Cleared: $15,000.00 (dropped by $5,000.00)
    const aliceBal = await ledgerRepo.getBalance(aliceAvailableId);
    expect(aliceBal?.availableBalance.amountCents).toBe(1500000n);
    expect(aliceBal?.reservedBalance.amountCents).toBe(0n);
    expect(aliceBal?.clearedBalance.amountCents).toBe(1500000n);
  });

  it('Scenario 3: should reject attempting to settle an already settled reservation', async () => {
    await expect(
      settleResUseCase.execute({
        reservationId: firstReservationId,
        clientReferenceId: 'settle_duplicate_attempt',
        idempotencyKey: 'idemp_settle_duplicate',
        destinationAccountId: bankAssetAccountId,
        settleAmount: Money.fromCents(500000n, 'ARS'),
        description: 'Illegal double settlement',
      })
    ).rejects.toThrow(/RESERVATION_ALREADY_SETTLED/i);
  });

  it('Scenario 4: should reject attempting to release an already settled reservation', async () => {
    await expect(
      releaseResUseCase.execute({
        reservationId: firstReservationId,
        clientReferenceId: 'release_settled_attempt',
        idempotencyKey: 'idemp_release_settled',
        reason: 'USER_CANCELLED',
        description: 'Illegal release on settled funds',
      })
    ).rejects.toThrow(/CANNOT_RELEASE_SETTLED_RESERVATION/i);
  });

  it('Scenario 5: should create and release a reservation (compensatory storno), restoring available balance', async () => {
    // 1. Create second reservation for $3,000.00
    const res = await createResUseCase.execute({
      clientReferenceId: 'res_order_1002',
      idempotencyKey: 'idemp_order_1002',
      accountId: aliceAvailableId,
      reservedAccountId: aliceReservedId,
      amount: Money.fromCents(300000n, 'ARS'),
      expiresAt: new Date(Date.now() + 3600000),
      description: 'Reservation for payment $3,000.00',
    });

    secondReservationId = res.reservationId;

    let aliceBal = await ledgerRepo.getBalance(aliceAvailableId);
    expect(aliceBal?.availableBalance.amountCents).toBe(1200000n);
    expect(aliceBal?.reservedBalance.amountCents).toBe(300000n);

    // 2. Release reservation (e.g. external network rejected or timeout)
    const releaseResult = await releaseResUseCase.execute({
      reservationId: secondReservationId,
      clientReferenceId: 'rel_order_1002',
      idempotencyKey: 'idemp_rel_order_1002',
      reason: 'EXTERNAL_REJECTED',
      description: 'External clearing network rejected transaction',
    });

    expect(releaseResult.isIdempotentReplay).toBe(false);

    // Balance restored: Available back to $15,000.00, Reserved back to $0.00
    aliceBal = await ledgerRepo.getBalance(aliceAvailableId);
    expect(aliceBal?.availableBalance.amountCents).toBe(1500000n);
    expect(aliceBal?.reservedBalance.amountCents).toBe(0n);
    expect(aliceBal?.clearedBalance.amountCents).toBe(1500000n);

    const record = await resRepo.getReservationById(secondReservationId);
    expect(record?.status).toBe('RELEASED');
  });

  it('Scenario 6: should reject attempting to settle or re-release an already released reservation', async () => {
    // Settle released -> fails
    await expect(
      settleResUseCase.execute({
        reservationId: secondReservationId,
        clientReferenceId: 'settle_released_attempt',
        idempotencyKey: 'idemp_settle_rel',
        destinationAccountId: bankAssetAccountId,
        settleAmount: Money.fromCents(300000n, 'ARS'),
        description: 'Illegal settle on released',
      })
    ).rejects.toThrow(/RESERVATION_NOT_ACTIVE/i);

    // Release released again with new client reference -> fails
    await expect(
      releaseResUseCase.execute({
        reservationId: secondReservationId,
        clientReferenceId: 're_release_attempt',
        idempotencyKey: 'idemp_re_release',
        reason: 'USER_CANCELLED',
        description: 'Duplicate release attempt',
      })
    ).rejects.toThrow(/RESERVATION_ALREADY_RELEASED/i);
  });

  it('Scenario 7: should create and expire a reservation, marking status EXPIRED', async () => {
    const res = await createResUseCase.execute({
      clientReferenceId: 'res_order_1003',
      idempotencyKey: 'idemp_order_1003',
      accountId: aliceAvailableId,
      reservedAccountId: aliceReservedId,
      amount: Money.fromCents(100000n, 'ARS'),
      expiresAt: new Date(Date.now() - 1000), // Already past expiration
      description: 'Expired reservation test',
    });

    await releaseResUseCase.execute({
      reservationId: res.reservationId,
      clientReferenceId: 'rel_order_1003_exp',
      idempotencyKey: 'idemp_rel_1003_exp',
      reason: 'EXPIRED',
      description: 'Reservation TTL expired',
    });

    const record = await resRepo.getReservationById(res.reservationId);
    expect(record?.status).toBe('EXPIRED');
  });

  it('Scenario 8: should verify 100% balance reconstruction from historical ledger lines without discrepancies', async () => {
    const auditRows = await ledgerRepo.auditReconcileBalances();

    expect(auditRows.length).toBeGreaterThan(0);
    for (const row of auditRows) {
      expect(row.discrepancyCents).toBe(0n);
      expect(row.materializedClearedCents).toBe(row.sumCalculatedCents);
    }
  });
});
