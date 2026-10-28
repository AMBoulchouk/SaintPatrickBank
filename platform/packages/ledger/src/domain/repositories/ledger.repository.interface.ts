import type { Money } from '@spbk/shared-kernel';
import type { LedgerAccount } from '../entities/ledger-account.js';
import type { AccountBalance } from '../entities/account-balance.js';

export interface PostTransferCommand {
  readonly clientReferenceId: string;
  readonly requestHash: string;
  readonly idempotencyKey: string;
  readonly sourceAccountId: string;
  readonly destAccountId: string;
  readonly amount: Money;
  readonly description: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface TransferResult {
  readonly operationId: string;
  readonly journalEntryId: string;
  readonly sourceAvailableBalance: Money;
  readonly destAvailableBalance: Money;
  readonly postedAt: Date;
  readonly isIdempotentReplay: boolean;
}

export interface AuditReconciliationRow {
  readonly accountId: string;
  readonly accountCode: string;
  readonly materializedClearedCents: bigint;
  readonly sumCalculatedCents: bigint;
  readonly discrepancyCents: bigint;
}

export interface ILedgerRepository {
  getAccountById(accountId: string): Promise<LedgerAccount | null>;
  getAccountByCode(code: string): Promise<LedgerAccount | null>;
  getBalance(accountId: string): Promise<AccountBalance | null>;
  postTransfer(command: PostTransferCommand): Promise<TransferResult>;
  auditReconcileBalances(): Promise<readonly AuditReconciliationRow[]>;
}
