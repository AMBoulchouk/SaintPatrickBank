import type { JournalLine } from './journal-line.js';

export interface JournalEntryProps {
  readonly id: string;
  readonly sequenceId: bigint;
  readonly financialOperationId: string;
  readonly idempotencyKey: string;
  readonly entryType: string;
  readonly description: string;
  readonly isLocked: boolean;
  readonly postedAt: Date;
  readonly lines: readonly JournalLine[];
}

export class JournalEntry {
  constructor(private readonly props: JournalEntryProps) {
    if (this.props.lines.length < 2) {
      throw new Error(`INV-01 violation: journal entry must have at least 2 lines, got ${this.props.lines.length}`);
    }

    // Verify zero-sum per currency
    const currencyTotals = new Map<string, bigint>();
    for (const line of this.props.lines) {
      const current = currencyTotals.get(line.currency) ?? 0n;
      const delta = line.isDebit() ? line.amount.amountCents : -line.amount.amountCents;
      currencyTotals.set(line.currency, current + delta);
    }

    for (const [currency, net] of currencyTotals.entries()) {
      if (net !== 0n) {
        throw new Error(`INV-02 violation: entry does not balance for currency ${currency}. Net: ${net}`);
      }
    }
  }

  get id(): string { return this.props.id; }
  get sequenceId(): bigint { return this.props.sequenceId; }
  get financialOperationId(): string { return this.props.financialOperationId; }
  get idempotencyKey(): string { return this.props.idempotencyKey; }
  get entryType(): string { return this.props.entryType; }
  get description(): string { return this.props.description; }
  get isLocked(): boolean { return this.props.isLocked; }
  get postedAt(): Date { return this.props.postedAt; }
  get lines(): readonly JournalLine[] { return this.props.lines; }
}
