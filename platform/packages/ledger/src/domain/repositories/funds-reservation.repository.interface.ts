import type { Money } from '@spbk/shared-kernel';
import type { FundsReservation } from '../entities/funds-reservation.js';

export interface CreateReservationCommand {
  readonly clientReferenceId: string;
  readonly requestHash: string;
  readonly idempotencyKey: string;
  readonly accountId: string;
  readonly reservedAccountId: string;
  readonly amount: Money;
  readonly expiresAt: Date;
  readonly description: string;
  readonly metadata?: Record<string, unknown> | undefined;
}

export interface ReservationResult {
  readonly reservationId: string;
  readonly operationId: string;
  readonly journalEntryId: string;
  readonly availableBalance: Money;
  readonly reservedBalance: Money;
  readonly isIdempotentReplay: boolean;
}

export interface SettleReservationCommand {
  readonly reservationId: string;
  readonly clientReferenceId: string;
  readonly requestHash: string;
  readonly idempotencyKey: string;
  readonly destinationAccountId: string;
  readonly settleAmount: Money;
  readonly description: string;
}

export interface SettleResult {
  readonly operationId: string;
  readonly journalEntryId: string;
  readonly isIdempotentReplay: boolean;
}

export interface ReleaseReservationCommand {
  readonly reservationId: string;
  readonly clientReferenceId: string;
  readonly requestHash: string;
  readonly idempotencyKey: string;
  readonly reason: 'EXPIRED' | 'USER_CANCELLED' | 'EXTERNAL_REJECTED';
  readonly description: string;
}

export interface ReleaseResult {
  readonly operationId: string;
  readonly journalEntryId: string;
  readonly isIdempotentReplay: boolean;
}

export interface IFundsReservationRepository {
  getReservationById(reservationId: string): Promise<FundsReservation | null>;
  createReservation(command: CreateReservationCommand): Promise<ReservationResult>;
  settleReservation(command: SettleReservationCommand): Promise<SettleResult>;
  releaseReservation(command: ReleaseReservationCommand): Promise<ReleaseResult>;
}
