import type { Pool } from 'pg';
import {
  LedgerReaderPort,
  AccountBalanceSnapshot,
  PaginatedTransactionsSnapshot,
  PaginationOptions,
} from '../../domain/ports/ledger-reader.port.interface.js';

interface BalanceRow {
  account_id: string;
  currency: string;
  available_balance_cents: string;
  cleared_balance_cents: string;
  reserved_balance_cents: string;
  updated_at: Date;
}

interface TransactionRow {
  id: string;
  entry_number: number;
  direction: 'DEBIT' | 'CREDIT';
  amount_cents: string;
  currency: string;
  description: string;
  posted_at: Date;
}

export class PostgresLedgerReaderAdapter implements LedgerReaderPort {
  constructor(private readonly pool: Pool) {}

  async getAccountBalance(ledgerAccountId: string): Promise<AccountBalanceSnapshot> {
    const res = await this.pool.query<BalanceRow>(
      `SELECT 
        account_id, 
        currency, 
        available_balance_cents, 
        cleared_balance_cents, 
        reserved_balance_cents, 
        updated_at
       FROM ledger.account_balances 
       WHERE account_id = $1`,
      [ledgerAccountId],
    );

    const row = res.rows[0];
    if (!row) {
      // Default empty zero balance if account has no movements yet
      return {
        accountId: ledgerAccountId,
        currency: 'ARS',
        availableCents: 0n,
        clearedCents: 0n,
        reservedCents: 0n,
        asOf: new Date(),
      };
    }

    return {
      accountId: row.account_id,
      currency: row.currency,
      availableCents: BigInt(row.available_balance_cents),
      clearedCents: BigInt(row.cleared_balance_cents),
      reservedCents: BigInt(row.reserved_balance_cents),
      asOf: row.updated_at ?? new Date(),
    };
  }

  async getTransactionHistory(
    ledgerAccountId: string,
    options: PaginationOptions,
  ): Promise<PaginatedTransactionsSnapshot> {
    const limit = Math.max(1, Math.min(100, options.limit));
    const offset = Math.max(0, options.offset);

    // Count total lines
    const countRes = await this.pool.query<{ count: string }>(
      `SELECT COUNT(*) as count FROM ledger.journal_lines WHERE account_id = $1`,
      [ledgerAccountId],
    );
    const total = parseInt(countRes.rows[0]?.count ?? '0', 10);

    // Fetch items ordered by journal entry sequence
    const itemsRes = await this.pool.query<TransactionRow>(
      `SELECT 
        l.id,
        l.entry_number,
        l.direction,
        l.amount_cents,
        l.currency,
        e.description,
        e.posted_at
       FROM ledger.journal_lines l
       JOIN ledger.journal_entries e ON l.journal_entry_id = e.id
       WHERE l.account_id = $1
       ORDER BY e.sequence_id DESC, l.entry_number ASC
       LIMIT $2 OFFSET $3`,
      [ledgerAccountId, limit, offset],
    );

    return {
      items: itemsRes.rows.map((row) => ({
        id: row.id,
        entryNumber: row.entry_number,
        direction: row.direction,
        amountCents: BigInt(row.amount_cents),
        currency: row.currency,
        description: row.description,
        postedAt: row.posted_at,
      })),
      total,
      limit,
      offset,
    };
  }
}
