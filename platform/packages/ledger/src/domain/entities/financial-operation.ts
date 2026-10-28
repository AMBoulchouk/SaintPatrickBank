import type { Money } from '@spbk/shared-kernel';

export type OperationStatus =
  | 'INITIATED'
  | 'PENDING_FUNDS_RESERVATION'
  | 'PENDING_EXTERNAL_CONFIRMATION'
  | 'CONFIRMED'
  | 'REJECTED'
  | 'REVERSED';

export interface FinancialOperationProps {
  readonly id: string;
  readonly clientReferenceId: string;
  readonly requestHash: string;
  readonly operationType: string;
  readonly status: OperationStatus;
  readonly sourceAccountId?: string | null;
  readonly destinationAccountId?: string | null;
  readonly amount: Money;
  readonly currency: string;
  readonly reversalOfOperationId?: string | null;
  readonly metadata?: Record<string, unknown>;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export class FinancialOperation {
  constructor(private readonly props: FinancialOperationProps) {}

  get id(): string { return this.props.id; }
  get clientReferenceId(): string { return this.props.clientReferenceId; }
  get requestHash(): string { return this.props.requestHash; }
  get operationType(): string { return this.props.operationType; }
  get status(): OperationStatus { return this.props.status; }
  get sourceAccountId(): string | null | undefined { return this.props.sourceAccountId; }
  get destinationAccountId(): string | null | undefined { return this.props.destinationAccountId; }
  get amount(): Money { return this.props.amount; }
  get currency(): string { return this.props.currency; }
  get reversalOfOperationId(): string | null | undefined { return this.props.reversalOfOperationId; }
  get metadata(): Record<string, unknown> | undefined { return this.props.metadata; }
  get createdAt(): Date { return this.props.createdAt; }
  get updatedAt(): Date { return this.props.updatedAt; }

  isConfirmed(): boolean { return this.props.status === 'CONFIRMED'; }
  isRejected(): boolean { return this.props.status === 'REJECTED'; }
  isReversed(): boolean { return this.props.status === 'REVERSED'; }
}
