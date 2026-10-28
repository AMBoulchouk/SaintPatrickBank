import type { Money } from '@spbk/shared-kernel';
import type { BalanceDirection } from './ledger-account.js';

export interface JournalLineProps {
  readonly id: string;
  readonly journalEntryId: string;
  readonly accountId: string;
  readonly entryNumber: number;
  readonly direction: BalanceDirection;
  readonly amount: Money;
  readonly currency: string;
}

export class JournalLine {
  constructor(private readonly props: JournalLineProps) {
    if (this.props.amount.amountCents <= 0n) {
      throw new Error(`Line amount must be strictly positive: ${this.props.amount.amountCents}`);
    }
  }

  get id(): string { return this.props.id; }
  get journalEntryId(): string { return this.props.journalEntryId; }
  get accountId(): string { return this.props.accountId; }
  get entryNumber(): number { return this.props.entryNumber; }
  get direction(): BalanceDirection { return this.props.direction; }
  get amount(): Money { return this.props.amount; }
  get currency(): string { return this.props.currency; }

  isDebit(): boolean { return this.props.direction === 'DEBIT'; }
  isCredit(): boolean { return this.props.direction === 'CREDIT'; }
}
