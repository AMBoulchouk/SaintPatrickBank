import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Money } from '@spbk/shared-kernel';
import {
  runMigrations,
  PostgresLedgerRepository,
  PostTransferUseCase,
} from '@spbk/ledger';
import {
  PostgresPaymentAccountRepository,
  PostgresLedgerReaderAdapter,
  LedgerTransferAdapter,
  GetAccountUseCase,
  ListCustomerAccountsUseCase,
  GetAccountBalanceUseCase,
  GetAccountTransactionsUseCase,
  ExecuteInternalTransferUseCase,
  PaymentAccount,
  CVU,
  AccountAlias,
  AccountNotFoundException,
  UnauthorizedAccountAccessException,
  AccountNotActiveException,
  AccountCannotReceiveException,
  SingleTransferLimitExceededException,
  InsufficientKycLevelException,
  InvalidTransferAmountException,
} from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Accounts ↔ Ledger Bounded Contexts Integration (PostgreSQL 18)', () => {
  let container: StartedPostgreSqlContainer;
  let adminPool: Pool;
  let appPool: Pool;

  let accountRepo: PostgresPaymentAccountRepository;
  let ledgerReader: PostgresLedgerReaderAdapter;
  let ledgerRepo: PostgresLedgerRepository;
  let postTransferUseCase: PostTransferUseCase;
  let transferAdapter: LedgerTransferAdapter;

  let getAccountUseCase: GetAccountUseCase;
  let listAccountsUseCase: ListCustomerAccountsUseCase;
  let getBalanceUseCase: GetAccountBalanceUseCase;
  let getTransactionsUseCase: GetAccountTransactionsUseCase;
  let executeTransferUseCase: ExecuteInternalTransferUseCase;

  const CUST_ALICE_ID = '11111111-1111-1111-1111-111111111111';
  const CUST_BOB_ID = '22222222-2222-2222-2222-222222222222';
  const CUST_CHARLIE_ID = '33333333-3333-3333-3333-333333333333';
  const CUST_SUSPENDED_ID = '44444444-4444-4444-4444-444444444444';
  const CUST_BLOCKED_ID = '55555555-5555-5555-5555-555555555555';

  const ALICE_ACCOUNT_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const BOB_ACCOUNT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  const CHARLIE_ACCOUNT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  const SUSPENDED_ACCOUNT_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  const BLOCKED_ACCOUNT_ID = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

  const ALICE_LEDGER_ID = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
  const BOB_LEDGER_ID = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
  const CHARLIE_LEDGER_ID = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';
  const SUSPENDED_LEDGER_ID = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
  const BLOCKED_LEDGER_ID = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';
  const BANK_SIGHT_LEDGER_ID = '00000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18')
      .withDatabase('saintpatrickbk_test')
      .withUsername('postgres')
      .withPassword('postgres')
      .start();

    adminPool = new Pool({
      connectionString: container.getConnectionUri(),
    });

    // Execute migrations 001 through 006
    const migrationsDir = path.resolve(__dirname, '../../../ledger/migrations');
    await runMigrations(adminPool, migrationsDir);

    // App pool runs with spbk_app role (strictly least-privilege)
    appPool = new Pool({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: 'spbk_app',
      password: 'spbk_app_dev_secret',
    });

    accountRepo = new PostgresPaymentAccountRepository(appPool);
    ledgerReader = new PostgresLedgerReaderAdapter(appPool);
    ledgerRepo = new PostgresLedgerRepository(appPool);
    postTransferUseCase = new PostTransferUseCase(ledgerRepo);
    transferAdapter = new LedgerTransferAdapter(postTransferUseCase);

    getAccountUseCase = new GetAccountUseCase(accountRepo);
    listAccountsUseCase = new ListCustomerAccountsUseCase(accountRepo);
    getBalanceUseCase = new GetAccountBalanceUseCase(accountRepo, ledgerReader);
    getTransactionsUseCase = new GetAccountTransactionsUseCase(accountRepo, ledgerReader);
    executeTransferUseCase = new ExecuteInternalTransferUseCase(accountRepo, transferAdapter);

    // Seed Ledger Chart of Accounts and Initial Balances
    await adminPool.query(`
      -- Bank Sight Asset Account (1101)
      INSERT INTO ledger.ledger_accounts (id, code, name, account_class, normal_balance, currency, status)
      VALUES ('${BANK_SIGHT_LEDGER_ID}', '1101-BCRA-RESERVE', 'BCRA Sight Deposit', 'ASSET', 'DEBIT', 'ARS', 'ACTIVE');

      INSERT INTO ledger.account_balances (account_id, currency, cleared_balance_cents, available_balance_cents, reserved_balance_cents)
      VALUES ('${BANK_SIGHT_LEDGER_ID}', 'ARS', 100000000, 100000000, 0);

      -- Customer Alice Liability Account (2101-CUST-ALICE): Initial $50,000.00 ARS
      INSERT INTO ledger.ledger_accounts (id, code, name, account_class, normal_balance, currency, status)
      VALUES ('${ALICE_LEDGER_ID}', '2101-CUST-ALICE', 'Alice Liability', 'LIABILITY', 'CREDIT', 'ARS', 'ACTIVE');

      INSERT INTO ledger.account_balances (account_id, currency, cleared_balance_cents, available_balance_cents, reserved_balance_cents)
      VALUES ('${ALICE_LEDGER_ID}', 'ARS', 5000000, 5000000, 0);

      -- Customer Bob Liability Account (2101-CUST-BOB): Initial $10,000.00 ARS
      INSERT INTO ledger.ledger_accounts (id, code, name, account_class, normal_balance, currency, status)
      VALUES ('${BOB_LEDGER_ID}', '2101-CUST-BOB', 'Bob Liability', 'LIABILITY', 'CREDIT', 'ARS', 'ACTIVE');

      INSERT INTO ledger.account_balances (account_id, currency, cleared_balance_cents, available_balance_cents, reserved_balance_cents)
      VALUES ('${BOB_LEDGER_ID}', 'ARS', 1000000, 1000000, 0);

      -- Other Customer Ledger Accounts
      INSERT INTO ledger.ledger_accounts (id, code, name, account_class, normal_balance, currency, status)
      VALUES 
        ('${CHARLIE_LEDGER_ID}', '2101-CUST-CHARLIE', 'Charlie Liability', 'LIABILITY', 'CREDIT', 'ARS', 'ACTIVE'),
        ('${SUSPENDED_LEDGER_ID}', '2101-CUST-SUSPENDED', 'Suspended Liability', 'LIABILITY', 'CREDIT', 'ARS', 'ACTIVE'),
        ('${BLOCKED_LEDGER_ID}', '2101-CUST-BLOCKED', 'Blocked Liability', 'LIABILITY', 'CREDIT', 'ARS', 'ACTIVE');

      INSERT INTO ledger.account_balances (account_id, currency, cleared_balance_cents, available_balance_cents, reserved_balance_cents)
      VALUES 
        ('${CHARLIE_LEDGER_ID}', 'ARS', 500000, 500000, 0),
        ('${SUSPENDED_LEDGER_ID}', 'ARS', 500000, 500000, 0),
        ('${BLOCKED_LEDGER_ID}', 'ARS', 500000, 500000, 0);

      -- Seed Initial Journal Entries to support historical balance reconstruction
      INSERT INTO ledger.financial_operations (id, client_reference_id, request_hash, operation_type, status, amount_cents, currency)
      VALUES 
        ('f1111111-1111-1111-1111-111111111111', 'SEED_ALICE_INIT', 'seedhashalice00000000000000000000000000000000000000000000000000', 'TOP_UP', 'CONFIRMED', 5000000, 'ARS'),
        ('f2222222-2222-2222-2222-222222222222', 'SEED_BOB_INIT', 'seedhashbob0000000000000000000000000000000000000000000000000000', 'TOP_UP', 'CONFIRMED', 1000000, 'ARS');

      INSERT INTO ledger.journal_entries (id, financial_operation_id, idempotency_key, entry_type, description, is_locked)
      VALUES 
        ('e1111111-1111-1111-1111-111111111111', 'f1111111-1111-1111-1111-111111111111', 'KEY_SEED_ALICE', 'INITIAL_DEPOSIT', 'Seed Alice initial funds', FALSE),
        ('e2222222-2222-2222-2222-222222222222', 'f2222222-2222-2222-2222-222222222222', 'KEY_SEED_BOB', 'INITIAL_DEPOSIT', 'Seed Bob initial funds', FALSE);

      INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
      VALUES 
        ('e1111111-1111-1111-1111-111111111111', '${BANK_SIGHT_LEDGER_ID}', 1, 'DEBIT', 5000000, 'ARS'),
        ('e1111111-1111-1111-1111-111111111111', '${ALICE_LEDGER_ID}', 2, 'CREDIT', 5000000, 'ARS'),
        ('e2222222-2222-2222-2222-222222222222', '${BANK_SIGHT_LEDGER_ID}', 1, 'DEBIT', 1000000, 'ARS'),
        ('e2222222-2222-2222-2222-222222222222', '${BOB_LEDGER_ID}', 2, 'CREDIT', 1000000, 'ARS');
    `);

    // Lock initial seed entries
    await adminPool.query(`UPDATE ledger.journal_entries SET is_locked = TRUE WHERE is_locked = FALSE;`);

    // Seed Operational Payment Accounts (@spbk/accounts)
    await accountRepo.save(
      new PaymentAccount({
        id: ALICE_ACCOUNT_ID,
        customerId: CUST_ALICE_ID,
        accountNumber: 'SPBK-0001-ALICE',
        cvu: new CVU('0000001700000000000111'),
        alias: new AccountAlias('alice.spbk'),
        currency: 'ARS',
        status: 'ACTIVE',
        dailyTransferLimitCents: 500000000n,
        singleTransferLimitCents: 200000000n, // $2,000,000 ARS single limit
        ledgerAccountId: ALICE_LEDGER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await accountRepo.save(
      new PaymentAccount({
        id: BOB_ACCOUNT_ID,
        customerId: CUST_BOB_ID,
        accountNumber: 'SPBK-0002-BOB',
        cvu: new CVU('0000001700000000000222'),
        alias: new AccountAlias('bob.spbk'),
        currency: 'ARS',
        status: 'ACTIVE',
        dailyTransferLimitCents: 500000000n,
        singleTransferLimitCents: 200000000n,
        ledgerAccountId: BOB_LEDGER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await accountRepo.save(
      new PaymentAccount({
        id: CHARLIE_ACCOUNT_ID,
        customerId: CUST_CHARLIE_ID,
        accountNumber: 'SPBK-0003-CHARLIE',
        cvu: new CVU('0000001700000000000333'),
        alias: new AccountAlias('charlie.spbk'),
        currency: 'ARS',
        status: 'ACTIVE',
        dailyTransferLimitCents: 500000000n,
        singleTransferLimitCents: 200000000n,
        ledgerAccountId: CHARLIE_LEDGER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await accountRepo.save(
      new PaymentAccount({
        id: SUSPENDED_ACCOUNT_ID,
        customerId: CUST_SUSPENDED_ID,
        accountNumber: 'SPBK-0004-SUSP',
        cvu: new CVU('0000001700000000000444'),
        alias: new AccountAlias('suspended.spbk'),
        currency: 'ARS',
        status: 'SUSPENDED',
        dailyTransferLimitCents: 500000000n,
        singleTransferLimitCents: 200000000n,
        ledgerAccountId: SUSPENDED_LEDGER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );

    await accountRepo.save(
      new PaymentAccount({
        id: BLOCKED_ACCOUNT_ID,
        customerId: CUST_BLOCKED_ID,
        accountNumber: 'SPBK-0005-BLOCK',
        cvu: new CVU('0000001700000000000555'),
        alias: new AccountAlias('blocked.spbk'),
        currency: 'ARS',
        status: 'BLOCKED',
        dailyTransferLimitCents: 500000000n,
        singleTransferLimitCents: 200000000n,
        ledgerAccountId: BLOCKED_LEDGER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  }, 90000);

  afterAll(async () => {
    if (appPool) await appPool.end();
    if (adminPool) await adminPool.end();
    if (container) await container.stop();
  }, 60000);

  // ---------------------------------------------------------------------------
  // 1. Own Account Query vs Foreign Account Query (Resource-Level Authorization)
  // ---------------------------------------------------------------------------
  it('Scenario 1: should allow querying own account details', async () => {
    const account = await getAccountUseCase.execute(ALICE_ACCOUNT_ID, {
      subjectId: CUST_ALICE_ID,
      roles: ['ROLE_CUSTOMER'],
      kycStatus: 'VERIFIED',
    });

    expect(account.id).toBe(ALICE_ACCOUNT_ID);
    expect(account.customerId).toBe(CUST_ALICE_ID);
    expect(account.cvu).toBe('0000001700000000000111');
    expect(account.alias).toBe('alice.spbk');
    expect(account.status).toBe('ACTIVE');
  });

  it('Scenario 2: should reject querying a foreign account (FORBIDDEN_ACCOUNT_ACCESS)', async () => {
    // Alice attempts to inspect Bob's account
    await expect(
      getAccountUseCase.execute(BOB_ACCOUNT_ID, {
        subjectId: CUST_ALICE_ID,
        roles: ['ROLE_CUSTOMER'],
        kycStatus: 'VERIFIED',
      }),
    ).rejects.toThrow(UnauthorizedAccountAccessException);
  });

  it('Scenario 3: should reject transfer initiated from an account the caller does not own', async () => {
    // Alice attempts to move funds OUT of Bob's account into hers
    await expect(
      executeTransferUseCase.execute(
        {
          sourceAccountId: BOB_ACCOUNT_ID, // Bob's account!
          destinationIdentifier: ALICE_ACCOUNT_ID,
          amount: Money.fromCents(100000n, 'ARS'),
          clientReferenceId: 'MALICIOUS_STEAL_001',
          description: 'Malicious transfer attempt',
        },
        {
          subjectId: CUST_ALICE_ID,
          roles: ['ROLE_CUSTOMER'],
          kycStatus: 'VERIFIED',
        },
      ),
    ).rejects.toThrow(UnauthorizedAccountAccessException);
  });

  // ---------------------------------------------------------------------------
  // 2. Operational Account Statuses (SUSPENDED / BLOCKED / CLOSED)
  // ---------------------------------------------------------------------------
  it('Scenario 4: should reject outgoing transfer from a SUSPENDED account', async () => {
    await expect(
      executeTransferUseCase.execute(
        {
          sourceAccountId: SUSPENDED_ACCOUNT_ID,
          destinationIdentifier: ALICE_ACCOUNT_ID,
          amount: Money.fromCents(10000n, 'ARS'),
          clientReferenceId: 'TX_SUSPENDED_SRC',
          description: 'Transfer from suspended account',
        },
        {
          subjectId: CUST_SUSPENDED_ID,
          roles: ['ROLE_CUSTOMER'],
          kycStatus: 'VERIFIED',
        },
      ),
    ).rejects.toThrow(AccountNotActiveException);
  });

  it('Scenario 5: should reject transfer to a BLOCKED destination account', async () => {
    await expect(
      executeTransferUseCase.execute(
        {
          sourceAccountId: ALICE_ACCOUNT_ID,
          destinationIdentifier: BLOCKED_ACCOUNT_ID,
          amount: Money.fromCents(10000n, 'ARS'),
          clientReferenceId: 'TX_TO_BLOCKED',
          description: 'Transfer to blocked destination',
        },
        {
          subjectId: CUST_ALICE_ID,
          roles: ['ROLE_CUSTOMER'],
          kycStatus: 'VERIFIED',
        },
      ),
    ).rejects.toThrow(AccountCannotReceiveException);
  });

  // ---------------------------------------------------------------------------
  // 3. Validation: Non-existent accounts and invalid amounts
  // ---------------------------------------------------------------------------
  it('Scenario 6: should reject querying non-existent account (ACCOUNT_NOT_FOUND)', async () => {
    await expect(
      getAccountUseCase.execute('99999999-9999-9999-9999-999999999999', {
        subjectId: CUST_ALICE_ID,
        roles: ['ROLE_CUSTOMER'],
        kycStatus: 'VERIFIED',
      }),
    ).rejects.toThrow(AccountNotFoundException);
  });

  it('Scenario 7: should reject non-positive transfer amounts (INVALID_AMOUNT)', async () => {
    await expect(
      executeTransferUseCase.execute(
        {
          sourceAccountId: ALICE_ACCOUNT_ID,
          destinationIdentifier: BOB_ACCOUNT_ID,
          amount: Money.fromCents(0n, 'ARS'),
          clientReferenceId: 'TX_ZERO_AMOUNT',
          description: 'Zero amount transfer',
        },
        {
          subjectId: CUST_ALICE_ID,
          roles: ['ROLE_CUSTOMER'],
          kycStatus: 'VERIFIED',
        },
      ),
    ).rejects.toThrow(InvalidTransferAmountException);
  });

  it('Scenario 8: should reject transfers exceeding single transaction limit', async () => {
    // Limit is $2,000,000 ARS (200,000,000 cents); requesting 250,000,000 cents
    await expect(
      executeTransferUseCase.execute(
        {
          sourceAccountId: ALICE_ACCOUNT_ID,
          destinationIdentifier: BOB_ACCOUNT_ID,
          amount: Money.fromCents(250000000n, 'ARS'),
          clientReferenceId: 'TX_LIMIT_EXCEEDED',
          description: 'Excessive transfer amount',
        },
        {
          subjectId: CUST_ALICE_ID,
          roles: ['ROLE_CUSTOMER'],
          kycStatus: 'VERIFIED',
        },
      ),
    ).rejects.toThrow(SingleTransferLimitExceededException);
  });

  // ---------------------------------------------------------------------------
  // 4. KYC Enforcement
  // ---------------------------------------------------------------------------
  it('Scenario 9: should reject transfer when caller has unverified KYC status', async () => {
    // Charlie has KYC status PENDING
    await expect(
      executeTransferUseCase.execute(
        {
          sourceAccountId: CHARLIE_ACCOUNT_ID,
          destinationIdentifier: ALICE_ACCOUNT_ID,
          amount: Money.fromCents(50000n, 'ARS'),
          clientReferenceId: 'TX_UNVERIFIED_KYC',
          description: 'Transfer without KYC verification',
        },
        {
          subjectId: CUST_CHARLIE_ID,
          roles: ['ROLE_CUSTOMER'],
          kycStatus: 'PENDING',
        },
      ),
    ).rejects.toThrow(InsufficientKycLevelException);
  });

  // ---------------------------------------------------------------------------
  // 5. Successful Transfer, Balance Integrity, and Exact Monetary Deduction
  // ---------------------------------------------------------------------------
  it('Scenario 10: should execute a legitimate internal transfer between Alice and Bob via Alias', async () => {
    // Alice transfers $15,000.00 ARS (1,500,000 cents) to Bob via alias "bob.spbk"
    const receipt = await executeTransferUseCase.execute(
      {
        sourceAccountId: ALICE_ACCOUNT_ID,
        destinationIdentifier: 'bob.spbk', // Resolves via alias!
        amount: Money.fromCents(1500000n, 'ARS'),
        clientReferenceId: 'TX_LEGIT_001',
        description: 'Pago por servicios profesionales',
      },
      {
        subjectId: CUST_ALICE_ID,
        roles: ['ROLE_CUSTOMER'],
        kycStatus: 'VERIFIED',
      },
    );

    expect(receipt.status).toBe('CONFIRMED');
    expect(receipt.isIdempotentReplay).toBe(false);
    expect(receipt.amountCents).toBe('1500000');
    expect(receipt.amountFormatted).toBe('15000.00');

    // Verify Real-time Balances from Ledger
    const aliceBalance = await getBalanceUseCase.execute(ALICE_ACCOUNT_ID, {
      subjectId: CUST_ALICE_ID,
      roles: ['ROLE_CUSTOMER'],
      kycStatus: 'VERIFIED',
    });
    // 50,000.00 - 15,000.00 = 35,000.00 ARS
    expect(aliceBalance.availableCents).toBe('3500000');
    expect(aliceBalance.availableFormatted).toBe('35000.00');
    expect(aliceBalance.clearedCents).toBe('3500000');

    const bobBalance = await getBalanceUseCase.execute(BOB_ACCOUNT_ID, {
      subjectId: CUST_BOB_ID,
      roles: ['ROLE_CUSTOMER'],
      kycStatus: 'VERIFIED',
    });
    // 10,000.00 + 15,000.00 = 25,000.00 ARS
    expect(bobBalance.availableCents).toBe('2500000');
    expect(bobBalance.availableFormatted).toBe('25000.00');
    expect(bobBalance.clearedCents).toBe('2500000');
  });

  // ---------------------------------------------------------------------------
  // 6. Persistent Financial Idempotency
  // ---------------------------------------------------------------------------
  it('Scenario 11: should return original receipt on idempotent replay without moving funds again', async () => {
    // Replay identical command
    const replayed = await executeTransferUseCase.execute(
      {
        sourceAccountId: ALICE_ACCOUNT_ID,
        destinationIdentifier: 'bob.spbk',
        amount: Money.fromCents(1500000n, 'ARS'),
        clientReferenceId: 'TX_LEGIT_001', // Identical client reference
        description: 'Pago por servicios profesionales',
      },
      {
        subjectId: CUST_ALICE_ID,
        roles: ['ROLE_CUSTOMER'],
        kycStatus: 'VERIFIED',
      },
    );

    expect(replayed.isIdempotentReplay).toBe(true);

    // Alice's balance must REMAIN 35,000.00 ARS (no duplicate deduction!)
    const aliceBalance = await getBalanceUseCase.execute(ALICE_ACCOUNT_ID, {
      subjectId: CUST_ALICE_ID,
      roles: ['ROLE_CUSTOMER'],
      kycStatus: 'VERIFIED',
    });
    expect(aliceBalance.availableCents).toBe('3500000');
  });

  it('Scenario 12: should reject reusing reference ID with differing parameters (IDEMPOTENCY_CONFLICT)', async () => {
    // Alice re-submits 'TX_LEGIT_001' with a DIFFERENT amount ($20,000 instead of $15,000)
    await expect(
      executeTransferUseCase.execute(
        {
          sourceAccountId: ALICE_ACCOUNT_ID,
          destinationIdentifier: 'bob.spbk',
          amount: Money.fromCents(2000000n, 'ARS'),
          clientReferenceId: 'TX_LEGIT_001',
          description: 'Differing payload',
        },
        {
          subjectId: CUST_ALICE_ID,
          roles: ['ROLE_CUSTOMER'],
          kycStatus: 'VERIFIED',
        },
      ),
    ).rejects.toThrow(/IDEMPOTENCY_CONFLICT/i);
  });

  // ---------------------------------------------------------------------------
  // 7. Insufficient Funds & Concurrency Race Condition Protection
  // ---------------------------------------------------------------------------
  it('Scenario 13: should reject transfer when amount exceeds available balance', async () => {
    // Alice has $35,000 ARS available, attempts to transfer $40,000 ARS
    await expect(
      executeTransferUseCase.execute(
        {
          sourceAccountId: ALICE_ACCOUNT_ID,
          destinationIdentifier: 'bob.spbk',
          amount: Money.fromCents(4000000n, 'ARS'),
          clientReferenceId: 'TX_OVERDRAFT_ATTEMPT',
          description: 'Overdraft attempt',
        },
        {
          subjectId: CUST_ALICE_ID,
          roles: ['ROLE_CUSTOMER'],
          kycStatus: 'VERIFIED',
        },
      ),
    ).rejects.toThrow(/INSUFFICIENT_FUNDS/i);
  });

  it('Scenario 14: should handle concurrent transfers on limited balance preventing double-spending', async () => {
    // Alice has $35,000 ARS. Launch 5 simultaneous transfers of $20,000 ARS each ($100,000 total demand).
    // Exactly 1 can succeed ($35,000 - $20,000 = $15,000). The other 4 MUST be rejected.
    const concurrentRequests = Array.from({ length: 5 }, (_, i) =>
      executeTransferUseCase
        .execute(
          {
            sourceAccountId: ALICE_ACCOUNT_ID,
            destinationIdentifier: 'bob.spbk',
            amount: Money.fromCents(2000000n, 'ARS'),
            clientReferenceId: `TX_CONCURRENT_RACE_${i + 1}`,
            description: `Concurrent race attempt ${i + 1}`,
          },
          {
            subjectId: CUST_ALICE_ID,
            roles: ['ROLE_CUSTOMER'],
            kycStatus: 'VERIFIED',
          },
        )
        .then(() => ({ success: true }))
        .catch((err: Error) => ({ success: false, error: err.message })),
    );

    const results = await Promise.all(concurrentRequests);
    const successes = results.filter((r) => r.success);
    const failures = results.filter((r) => !r.success);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(4);
    failures.forEach((f) => expect(f.error).toMatch(/INSUFFICIENT_FUNDS/i));

    // Alice's final balance: exactly $15,000.00 ARS
    const finalBalance = await getBalanceUseCase.execute(ALICE_ACCOUNT_ID, {
      subjectId: CUST_ALICE_ID,
      roles: ['ROLE_CUSTOMER'],
      kycStatus: 'VERIFIED',
    });
    expect(finalBalance.availableCents).toBe('1500000');
    expect(finalBalance.availableFormatted).toBe('15000.00');
  });

  // ---------------------------------------------------------------------------
  // 8. Historical Ledger Transactions and Customer Isolation
  // ---------------------------------------------------------------------------
  it('Scenario 15: should retrieve historical transaction entries for Alice', async () => {
    const history = await getTransactionsUseCase.execute(
      ALICE_ACCOUNT_ID,
      { limit: 10, offset: 0 },
      {
        subjectId: CUST_ALICE_ID,
        roles: ['ROLE_CUSTOMER'],
        kycStatus: 'VERIFIED',
      },
    );

    expect(history.items.length).toBeGreaterThanOrEqual(3);
    // Movements: initial seed CREDIT (+50,000), legitimate transfer DEBIT (-15,000), race transfer DEBIT (-20,000)
    const seed = history.items.find((i) => i.direction === 'CREDIT');
    expect(seed).toBeDefined();
    expect(seed?.amountCents).toBe('5000000');
  });

  it('Scenario 16: should isolate customer accounts (Alice sees only hers)', async () => {
    const aliceAccounts = await listAccountsUseCase.execute({
      subjectId: CUST_ALICE_ID,
      roles: ['ROLE_CUSTOMER'],
      kycStatus: 'VERIFIED',
    });

    expect(aliceAccounts.length).toBe(1);
    expect(aliceAccounts[0]?.id).toBe(ALICE_ACCOUNT_ID);
    expect(aliceAccounts.some((a) => a.id === BOB_ACCOUNT_ID)).toBe(false);
  });
});
