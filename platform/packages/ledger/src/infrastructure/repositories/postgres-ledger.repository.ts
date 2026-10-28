import type { Pool } from 'pg';
import { Money } from '@spbk/shared-kernel';
import type {
  ILedgerRepository,
  PostTransferCommand,
  TransferResult,
  AuditReconciliationRow,
} from '../../domain/repositories/ledger.repository.interface.js';
import { LedgerAccount } from '../../domain/entities/ledger-account.js';
import { AccountBalance } from '../../domain/entities/account-balance.js';

export class PostgresLedgerRepository implements ILedgerRepository {
  constructor(private readonly pool: Pool) {}

  async getAccountById(accountId: string): Promise<LedgerAccount | null> {
    const res = await this.pool.query(
      `SELECT id, code, name, account_class, normal_balance, currency, status, created_at
       FROM ledger.ledger_accounts
       WHERE id = $1`,
      [accountId]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];

    return new LedgerAccount({
      id: row.id,
      code: row.code,
      name: row.name,
      accountClass: row.account_class,
      normalBalance: row.normal_balance,
      currency: row.currency,
      status: row.status,
      createdAt: new Date(row.created_at),
    });
  }

  async getAccountByCode(code: string): Promise<LedgerAccount | null> {
    const res = await this.pool.query(
      `SELECT id, code, name, account_class, normal_balance, currency, status, created_at
       FROM ledger.ledger_accounts
       WHERE code = $1`,
      [code]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];

    return new LedgerAccount({
      id: row.id,
      code: row.code,
      name: row.name,
      accountClass: row.account_class,
      normalBalance: row.normal_balance,
      currency: row.currency,
      status: row.status,
      createdAt: new Date(row.created_at),
    });
  }

  async getBalance(accountId: string): Promise<AccountBalance | null> {
    const res = await this.pool.query(
      `SELECT account_id, cleared_balance_cents, reserved_balance_cents, available_balance_cents, currency, version, updated_at
       FROM ledger.account_balances
       WHERE account_id = $1`,
      [accountId]
    );

    if (res.rows.length === 0) return null;
    const row = res.rows[0];

    return new AccountBalance({
      accountId: row.account_id,
      clearedBalance: Money.fromCents(BigInt(row.cleared_balance_cents), row.currency),
      reservedBalance: Money.fromCents(BigInt(row.reserved_balance_cents), row.currency),
      availableBalance: Money.fromCents(BigInt(row.available_balance_cents), row.currency),
      currency: row.currency,
      version: BigInt(row.version),
      updatedAt: new Date(row.updated_at),
    });
  }

  /**
   * CRITICAL SECURITY GUARANTEE:
   * Direct UPDATE on account_balances is completely forbidden.
   * Transfers MUST execute through the authorized SECURITY DEFINER procedure.
   */
  async postTransfer(command: PostTransferCommand): Promise<TransferResult> {
    const res = await this.pool.query(
      `SELECT out_operation_id, out_journal_entry_id, out_source_available, out_dest_available, out_posted_at, out_is_idempotent_replay
       FROM ledger.fn_post_transfer($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        command.clientReferenceId,
        command.requestHash,
        command.idempotencyKey,
        command.sourceAccountId,
        command.destAccountId,
        command.amount.amountCents.toString(),
        command.amount.currency,
        command.description,
        JSON.stringify(command.metadata ?? {}),
      ]
    );

    const row = res.rows[0];
    return {
      operationId: row.out_operation_id,
      journalEntryId: row.out_journal_entry_id,
      sourceAvailableBalance: Money.fromCents(BigInt(row.out_source_available), command.amount.currency),
      destAvailableBalance: Money.fromCents(BigInt(row.out_dest_available), command.amount.currency),
      postedAt: new Date(row.out_posted_at),
      isIdempotentReplay: Boolean(row.out_is_idempotent_replay),
    };
  }

  async auditReconcileBalances(): Promise<readonly AuditReconciliationRow[]> {
    const res = await this.pool.query(
      `SELECT account_id, account_code, materialized_cleared, sum_calculated_cents, discrepancy_cents
       FROM ledger.fn_audit_reconcile_balances()`
    );

    return res.rows.map((r) => ({
      accountId: r.account_id,
      accountCode: r.account_code,
      materializedClearedCents: BigInt(r.materialized_cleared),
      sumCalculatedCents: BigInt(r.sum_calculated_cents),
      discrepancyCents: BigInt(r.discrepancy_cents),
    }));
  }
}
