import { CurrencyCode } from '@spbk/shared-kernel';
import { CVU } from '../value-objects/cvu.js';
import { AccountAlias } from '../value-objects/account-alias.js';
import {
  AccountNotActiveException,
  AccountCannotReceiveException,
  SingleTransferLimitExceededException,
} from '../exceptions/account.exceptions.js';

export type AccountStatus = 'PENDING_KYC' | 'ACTIVE' | 'SUSPENDED' | 'BLOCKED' | 'CLOSED';

export interface PaymentAccountProps {
  readonly id: string;
  readonly customerId: string;
  readonly accountNumber: string;
  readonly cvu: CVU;
  readonly alias: AccountAlias;
  readonly currency: CurrencyCode;
  status: AccountStatus;
  readonly dailyTransferLimitCents: bigint;
  readonly singleTransferLimitCents: bigint;
  readonly ledgerAccountId: string;
  readonly createdAt: Date;
  updatedAt: Date;
}

export class PaymentAccount {
  private props: PaymentAccountProps;

  constructor(props: PaymentAccountProps) {
    this.props = { ...props };
  }

  get id(): string {
    return this.props.id;
  }

  get customerId(): string {
    return this.props.customerId;
  }

  get accountNumber(): string {
    return this.props.accountNumber;
  }

  get cvu(): CVU {
    return this.props.cvu;
  }

  get alias(): AccountAlias {
    return this.props.alias;
  }

  get currency(): CurrencyCode {
    return this.props.currency;
  }

  get status(): AccountStatus {
    return this.props.status;
  }

  get dailyTransferLimitCents(): bigint {
    return this.props.dailyTransferLimitCents;
  }

  get singleTransferLimitCents(): bigint {
    return this.props.singleTransferLimitCents;
  }

  get ledgerAccountId(): string {
    return this.props.ledgerAccountId;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  isOwnedBy(customerId: string): boolean {
    return this.props.customerId === customerId;
  }

  canTransact(): boolean {
    return this.props.status === 'ACTIVE';
  }

  assertCanTransact(): void {
    if (this.props.status !== 'ACTIVE') {
      throw new AccountNotActiveException(this.props.id, this.props.status);
    }
  }

  assertCanReceive(): void {
    if (this.props.status === 'CLOSED' || this.props.status === 'BLOCKED') {
      throw new AccountCannotReceiveException(this.props.id, this.props.status);
    }
  }

  assertWithinSingleLimit(amountCents: bigint): void {
    if (amountCents > this.props.singleTransferLimitCents) {
      throw new SingleTransferLimitExceededException(
        amountCents,
        this.props.singleTransferLimitCents,
      );
    }
  }

  suspend(_reason?: string): void {
    if (this.props.status === 'CLOSED') {
      throw new Error(`Cannot suspend closed account '${this.props.id}'`);
    }
    this.props.status = 'SUSPENDED';
    this.props.updatedAt = new Date();
  }

  block(_reason?: string): void {
    if (this.props.status === 'CLOSED') {
      throw new Error(`Cannot block closed account '${this.props.id}'`);
    }
    this.props.status = 'BLOCKED';
    this.props.updatedAt = new Date();
  }

  activate(): void {
    if (this.props.status === 'CLOSED') {
      throw new Error(`Cannot activate closed account '${this.props.id}'`);
    }
    this.props.status = 'ACTIVE';
    this.props.updatedAt = new Date();
  }

  close(_reason?: string): void {
    this.props.status = 'CLOSED';
    this.props.updatedAt = new Date();
  }
}
