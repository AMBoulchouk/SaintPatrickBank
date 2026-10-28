import { Money } from '@spbk/shared-kernel';

export interface TransferPostingCommand {
  readonly clientReferenceId: string;
  readonly idempotencyKey?: string | undefined;
  readonly sourceLedgerAccountId: string;
  readonly destLedgerAccountId: string;
  readonly amount: Money;
  readonly description: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface TransferPostingResult {
  readonly operationId: string;
  readonly journalEntryId: string;
  readonly sourceAvailableCents: bigint;
  readonly destAvailableCents: bigint;
  readonly postedAt: Date;
  readonly isIdempotentReplay: boolean;
}

/**
 * FinancialTransferPort: Outbound port used by @spbk/accounts to request financial postings from @spbk/ledger
 * Accounts never writes SQL directly; it delegates execution to the transactional core.
 */
export interface FinancialTransferPort {
  executeInternalTransfer(command: TransferPostingCommand): Promise<TransferPostingResult>;
}
