import { createHash } from 'node:crypto';
import type { Money } from '@spbk/shared-kernel';
import type { ILedgerRepository, TransferResult } from '../../domain/repositories/ledger.repository.interface.js';

export interface PostTransferInput {
  readonly clientReferenceId: string;
  readonly idempotencyKey: string;
  readonly sourceAccountId: string;
  readonly destAccountId: string;
  readonly amount: Money;
  readonly description: string;
  readonly metadata?: Record<string, unknown>;
}

export class PostTransferUseCase {
  constructor(private readonly ledgerRepo: ILedgerRepository) {}

  async execute(input: PostTransferInput): Promise<TransferResult> {
    const canonicalPayload = JSON.stringify({
      src: input.sourceAccountId,
      dst: input.destAccountId,
      amt: input.amount.amountCents.toString(),
      cur: input.amount.currency,
    });
    const requestHash = createHash('sha256').update(canonicalPayload).digest('hex');

    return this.ledgerRepo.postTransfer({
      clientReferenceId: input.clientReferenceId,
      requestHash,
      idempotencyKey: input.idempotencyKey,
      sourceAccountId: input.sourceAccountId,
      destAccountId: input.destAccountId,
      amount: input.amount,
      description: input.description,
      metadata: input.metadata,
    });
  }
}
