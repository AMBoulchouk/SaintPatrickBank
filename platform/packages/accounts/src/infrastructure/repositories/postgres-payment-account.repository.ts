import type { Pool } from 'pg';
import { PaymentAccount, AccountStatus } from '../../domain/entities/payment-account.js';
import { CVU } from '../../domain/value-objects/cvu.js';
import { AccountAlias } from '../../domain/value-objects/account-alias.js';
import { PaymentAccountRepository } from '../../domain/ports/payment-account.repository.interface.js';
import { CurrencyCode } from '@spbk/shared-kernel';

interface AccountRow {
  id: string;
  customer_id: string;
  account_number: string;
  cvu: string;
  alias: string;
  currency: string;
  status: string;
  daily_transfer_limit_cents: string;
  single_transfer_limit_cents: string;
  ledger_account_id: string;
  created_at: Date;
  updated_at: Date;
}

export class PostgresPaymentAccountRepository implements PaymentAccountRepository {
  constructor(private readonly pool: Pool) {}

  async findById(id: string): Promise<PaymentAccount | null> {
    const res = await this.pool.query<AccountRow>(
      `SELECT * FROM accounts.payment_accounts WHERE id = $1`,
      [id],
    );
    const row = res.rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByCustomerId(customerId: string): Promise<readonly PaymentAccount[]> {
    const res = await this.pool.query<AccountRow>(
      `SELECT * FROM accounts.payment_accounts WHERE customer_id = $1 ORDER BY created_at ASC`,
      [customerId],
    );
    return res.rows.map((row) => this.mapToDomain(row));
  }

  async findByCvu(cvu: string): Promise<PaymentAccount | null> {
    const res = await this.pool.query<AccountRow>(
      `SELECT * FROM accounts.payment_accounts WHERE cvu = $1`,
      [cvu],
    );
    const row = res.rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByAlias(alias: string): Promise<PaymentAccount | null> {
    const res = await this.pool.query<AccountRow>(
      `SELECT * FROM accounts.payment_accounts WHERE LOWER(alias) = LOWER($1)`,
      [alias],
    );
    const row = res.rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async findByLedgerAccountId(ledgerAccountId: string): Promise<PaymentAccount | null> {
    const res = await this.pool.query<AccountRow>(
      `SELECT * FROM accounts.payment_accounts WHERE ledger_account_id = $1`,
      [ledgerAccountId],
    );
    const row = res.rows[0];
    if (!row) return null;
    return this.mapToDomain(row);
  }

  async save(account: PaymentAccount): Promise<void> {
    await this.pool.query(
      `INSERT INTO accounts.payment_accounts (
        id, customer_id, account_number, cvu, alias, currency, status,
        daily_transfer_limit_cents, single_transfer_limit_cents,
        ledger_account_id, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT (id) DO UPDATE SET
        alias = EXCLUDED.alias,
        status = EXCLUDED.status,
        daily_transfer_limit_cents = EXCLUDED.daily_transfer_limit_cents,
        single_transfer_limit_cents = EXCLUDED.single_transfer_limit_cents,
        updated_at = NOW()`,
      [
        account.id,
        account.customerId,
        account.accountNumber,
        account.cvu.value,
        account.alias.value,
        account.currency,
        account.status,
        account.dailyTransferLimitCents,
        account.singleTransferLimitCents,
        account.ledgerAccountId,
        account.createdAt,
        account.updatedAt,
      ],
    );
  }

  async updateStatus(id: string, status: AccountStatus): Promise<void> {
    await this.pool.query(
      `UPDATE accounts.payment_accounts SET status = $1, updated_at = NOW() WHERE id = $2`,
      [status, id],
    );
  }

  private mapToDomain(row: AccountRow): PaymentAccount {
    return new PaymentAccount({
      id: row.id,
      customerId: row.customer_id,
      accountNumber: row.account_number,
      cvu: new CVU(row.cvu),
      alias: new AccountAlias(row.alias),
      currency: row.currency as CurrencyCode,
      status: row.status as AccountStatus,
      dailyTransferLimitCents: BigInt(row.daily_transfer_limit_cents),
      singleTransferLimitCents: BigInt(row.single_transfer_limit_cents),
      ledgerAccountId: row.ledger_account_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}
