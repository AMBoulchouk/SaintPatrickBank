import { createHash } from 'node:crypto';
import type {
  IFundsReservationRepository,
  ReleaseResult,
} from '../../domain/repositories/funds-reservation.repository.interface.js';

export interface ReleaseReservationInput {
  readonly reservationId: string;
  readonly clientReferenceId: string;
  readonly idempotencyKey: string;
  readonly reason: 'EXPIRED' | 'USER_CANCELLED' | 'EXTERNAL_REJECTED';
  readonly description: string;
}

export class ReleaseReservationUseCase {
  constructor(private readonly reservationRepo: IFundsReservationRepository) {}

  async execute(input: ReleaseReservationInput): Promise<ReleaseResult> {
    const canonicalPayload = JSON.stringify({
      resId: input.reservationId,
      reason: input.reason,
    });
    const requestHash = createHash('sha256').update(canonicalPayload).digest('hex');

    return this.reservationRepo.releaseReservation({
      reservationId: input.reservationId,
      clientReferenceId: input.clientReferenceId,
      requestHash,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      description: input.description,
    });
  }
}
