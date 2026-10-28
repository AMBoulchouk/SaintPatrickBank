/**
 * @spbk/accounts - Domain Contracts & Types
 * Virtual payment account lifecycle and CVU management.
 */

export type AccountStatus = 'PENDING_KYC' | 'ACTIVE' | 'BLOCKED' | 'FROZEN_LEGAL' | 'CLOSED';

export interface PaymentAccountDescriptor {
  readonly accountId: string;
  readonly userId: string;
  readonly cvu: string;
  readonly alias: string;
  readonly status: AccountStatus;
  readonly openedAt: string;
}
