export interface AccountBalanceSnapshot {
  readonly accountId: string;
  readonly currency: string;
  readonly availableCents: bigint;
  readonly clearedCents: bigint;
  readonly reservedCents: bigint;
  readonly asOf: Date;
}

export interface TransactionItemSnapshot {
  readonly id: string;
  readonly entryNumber: number;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly amountCents: bigint;
  readonly currency: string;
  readonly description: string;
  readonly postedAt: Date;
}

export interface PaginatedTransactionsSnapshot {
  readonly items: readonly TransactionItemSnapshot[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface PaginationOptions {
  readonly limit: number;
  readonly offset: number;
}

/**
 * LedgerReaderPort: Outbound port used by @spbk/accounts to query balance and history from @spbk/ledger
 * Notice: Accounts NEVER issues write queries on the ledger!
 */
export interface LedgerReaderPort {
  getAccountBalance(ledgerAccountId: string): Promise<AccountBalanceSnapshot>;
  getTransactionHistory(
    ledgerAccountId: string,
    options: PaginationOptions,
  ): Promise<PaginatedTransactionsSnapshot>;
}
