import { Money } from '@spbk/shared-kernel';

export interface AuthContext {
  readonly subjectId: string;
  readonly roles: readonly string[];
  readonly kycStatus: 'VERIFIED' | 'PENDING' | 'REJECTED';
}

export interface PaymentAccountDto {
  readonly id: string;
  readonly customerId: string;
  readonly accountNumber: string;
  readonly cvu: string;
  readonly alias: string;
  readonly currency: string;
  readonly status: string;
  readonly dailyTransferLimit: string;
  readonly singleTransferLimit: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AccountBalanceDto {
  readonly accountId: string;
  readonly currency: string;
  readonly availableCents: string;
  readonly availableFormatted: string;
  readonly clearedCents: string;
  readonly clearedFormatted: string;
  readonly reservedCents: string;
  readonly reservedFormatted: string;
  readonly asOf: string;
}

export interface TransactionItemDto {
  readonly id: string;
  readonly entryNumber: number;
  readonly direction: 'DEBIT' | 'CREDIT';
  readonly amountCents: string;
  readonly amountFormatted: string;
  readonly currency: string;
  readonly description: string;
  readonly postedAt: string;
}

export interface PaginatedTransactionsDto {
  readonly items: readonly TransactionItemDto[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

export interface InitiateTransferCommand {
  readonly sourceAccountId: string;
  readonly destinationIdentifier: string; // Account ID, CVU (22 digits), or Alias
  readonly amount: Money;
  readonly clientReferenceId: string;
  readonly idempotencyKey?: string | undefined;
  readonly description: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface TransferReceiptDto {
  readonly operationId: string;
  readonly journalEntryId: string;
  readonly clientReferenceId: string;
  readonly sourceAccountId: string;
  readonly destinationAccountId: string;
  readonly amountCents: string;
  readonly amountFormatted: string;
  readonly currency: string;
  readonly status: 'CONFIRMED';
  readonly isIdempotentReplay: boolean;
  readonly postedAt: string;
}
