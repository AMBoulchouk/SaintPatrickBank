/**
 * @spbk/ledger - Domain Contracts and Boundary Definitions
 * Full transactional engine and constraint verification will be reviewed and implemented in Phase 3.
 */

import { Money } from '@spbk/shared-kernel';

export type AccountClass = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type EntryDirection = 'DEBIT' | 'CREDIT';

export interface EntryLineDraft {
  readonly accountId: string;
  readonly direction: EntryDirection;
  readonly amount: Money;
}

export interface JournalEntryDraft {
  readonly idempotencyKey: string;
  readonly description: string;
  readonly lines: readonly EntryLineDraft[];
}

export const LEDGER_CONSTANTS = {
  CANONICAL_ASSET_SIGHT_ACCOUNT: '1101',
  CANONICAL_CUSTOMER_LIABILITY_ACCOUNT: '2101',
  CANONICAL_IN_FLIGHT_RESERVED_ACCOUNT: '2102',
} as const;
