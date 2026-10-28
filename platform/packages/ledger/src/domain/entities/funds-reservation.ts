import type { Money } from '@spbk/shared-kernel';

export type ReservationStatus = 'ACTIVE' | 'SETTLED' | 'RELEASED' | 'EXPIRED';

export interface FundsReservationProps {
  readonly id: string;
  readonly operationId: string;
  readonly accountId: string;
  readonly reservedAccountId: string;
  readonly amount: Money;
  readonly currency: string;
  readonly status: ReservationStatus;
  readonly creationJournalEntryId: string;
  readonly settlementJournalEntryId?: string | null;
  readonly releaseJournalEntryId?: string | null;
  readonly expiresAt: Date;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class FundsReservation {
  constructor(private readonly props: FundsReservationProps) {}

  get id(): string { return this.props.id; }
  get operationId(): string { return this.props.operationId; }
  get accountId(): string { return this.props.accountId; }
  get reservedAccountId(): string { return this.props.reservedAccountId; }
  get amount(): Money { return this.props.amount; }
  get currency(): string { return this.props.currency; }
  get status(): ReservationStatus { return this.props.status; }
  get creationJournalEntryId(): string { return this.props.creationJournalEntryId; }
  get settlementJournalEntryId(): string | null | undefined { return this.props.settlementJournalEntryId; }
  get releaseJournalEntryId(): string | null | undefined { return this.props.releaseJournalEntryId; }
  get expiresAt(): Date { return this.props.expiresAt; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  isActive(): boolean { return this.props.status === 'ACTIVE'; }
  isSettled(): boolean { return this.props.status === 'SETTLED'; }
  isReleased(): boolean { return this.props.status === 'RELEASED'; }
  isExpired(): boolean { return this.props.status === 'EXPIRED'; }

  isPastExpiration(now: Date = new Date()): boolean {
    return now.getTime() > this.props.expiresAt.getTime();
  }
}
