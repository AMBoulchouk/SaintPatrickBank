export type AccountClass = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';
export type BalanceDirection = 'DEBIT' | 'CREDIT';
export type AccountStatus = 'ACTIVE' | 'FROZEN' | 'CLOSED';

export interface LedgerAccountProps {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly accountClass: AccountClass;
  readonly normalBalance: BalanceDirection;
  readonly currency: string;
  readonly status: AccountStatus;
  readonly createdAt: Date;
}

export class LedgerAccount {
  constructor(private readonly props: LedgerAccountProps) {}

  get id(): string { return this.props.id; }
  get code(): string { return this.props.code; }
  get name(): string { return this.props.name; }
  get accountClass(): AccountClass { return this.props.accountClass; }
  get normalBalance(): BalanceDirection { return this.props.normalBalance; }
  get currency(): string { return this.props.currency; }
  get status(): AccountStatus { return this.props.status; }
  get createdAt(): Date { return this.props.createdAt; }

  isActive(): boolean {
    return this.props.status === 'ACTIVE';
  }

  isLiability(): boolean {
    return this.props.accountClass === 'LIABILITY';
  }

  isAsset(): boolean {
    return this.props.accountClass === 'ASSET';
  }
}
