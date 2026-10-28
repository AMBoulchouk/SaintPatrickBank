import { createHash } from 'node:crypto';
import type { Money } from '@spbk/shared-kernel';
import type {
  IFundsReservationRepository,
  SettleResult,
} from '../../domain/repositories/funds-reservation.repository.interface.js';

export interface SettleReservationInput {
  readonly reservationId: string;
  readonly clientReferenceId: string;
  readonly idempotencyKey: string;
  readonly destinationAccountId: string;
  readonly settleAmount: Money;
  readonly description: string;
}

export class SettleReservationUseCase {
  constructor(private readonly reservationRepo: IFundsReservationRepository) {}

  async execute(input: SettleReservationInput): Promise<SettleResult> {
    const canonicalPayload = JSON.stringify({
      resId: input.reservationId,
      dst: input.destinationAccountId,
      amt: input.settleAmount.amountCents.toString(),
      cur: input.settleAmount.currency,
    });
    const requestHash = createHash('sha256').update(canonicalPayload).digest('hex');

    return this.reservationRepo.settleReservation({
      reservationId: input.reservationId,
      clientReferenceId: input.clientReferenceId,
      requestHash,
      idempotencyKey: input.idempotencyKey,
      destinationAccountId: input.destinationAccountId,
      settleAmount: input.settleAmount,
      description: input.description,
    });
  }
}
