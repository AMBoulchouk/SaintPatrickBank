import type { Money } from '@spbk/shared-kernel';

export interface AccountBalanceProps {
  readonly accountId: string;
  readonly clearedBalance: Money;
  readonly reservedBalance: Money;
  readonly availableBalance: Money;
  readonly currency: string;
  readonly version: bigint;
  readonly updatedAt: Date;
}

export class AccountBalance {
  constructor(private readonly props: AccountBalanceProps) {
    // Mathematical invariant validation: cleared = available + reserved
    const computedCleared = this.props.availableBalance.add(this.props.reservedBalance);
    if (!computedCleared.equals(this.props.clearedBalance)) {
      throw new Error(
        `Invariant violation: cleared balance (${this.props.clearedBalance.amountCents}) must equal available (${this.props.availableBalance.amountCents}) + reserved (${this.props.reservedBalance.amountCents})`
      );
    }
  }

  get accountId(): string { return this.props.accountId; }
  get clearedBalance(): Money { return this.props.clearedBalance; }
  get reservedBalance(): Money { return this.props.reservedBalance; }
  get availableBalance(): Money { return this.props.availableBalance; }
  get currency(): string { return this.props.currency; }
  get version(): bigint { return this.props.version; }
  get updatedAt(): Date { return this.props.updatedAt; }

  hasSufficientAvailable(amount: Money): boolean {
    return this.props.availableBalance.amountCents >= amount.amountCents;
  }
}
