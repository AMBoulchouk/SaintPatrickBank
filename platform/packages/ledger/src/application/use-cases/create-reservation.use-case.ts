import { createHash } from 'node:crypto';
import type { Money } from '@spbk/shared-kernel';
import type {
  IFundsReservationRepository,
  ReservationResult,
} from '../../domain/repositories/funds-reservation.repository.interface.js';

export interface CreateReservationInput {
  readonly clientReferenceId: string;
  readonly idempotencyKey: string;
  readonly accountId: string;
  readonly reservedAccountId: string;
  readonly amount: Money;
  readonly expiresAt: Date;
  readonly description: string;
  readonly metadata?: Record<string, unknown>;
}

export class CreateReservationUseCase {
  constructor(private readonly reservationRepo: IFundsReservationRepository) {}

  async execute(input: CreateReservationInput): Promise<ReservationResult> {
    const canonicalPayload = JSON.stringify({
      acc: input.accountId,
      resAcc: input.reservedAccountId,
      amt: input.amount.amountCents.toString(),
      cur: input.amount.currency,
      exp: input.expiresAt.toISOString(),
    });
    const requestHash = createHash('sha256').update(canonicalPayload).digest('hex');

    return this.reservationRepo.createReservation({
      clientReferenceId: input.clientReferenceId,
      requestHash,
      idempotencyKey: input.idempotencyKey,
      accountId: input.accountId,
      reservedAccountId: input.reservedAccountId,
      amount: input.amount,
      expiresAt: input.expiresAt,
      description: input.description,
      metadata: input.metadata,
    });
  }
}
