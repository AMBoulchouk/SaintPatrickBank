import { PostTransferUseCase } from '@spbk/ledger';
import {
  FinancialTransferPort,
  TransferPostingCommand,
  TransferPostingResult,
} from '../../domain/ports/financial-transfer.port.interface.js';

export class LedgerTransferAdapter implements FinancialTransferPort {
  constructor(private readonly postTransferUseCase: PostTransferUseCase) {}

  async executeInternalTransfer(command: TransferPostingCommand): Promise<TransferPostingResult> {
    const result = await this.postTransferUseCase.execute({
      clientReferenceId: command.clientReferenceId,
      idempotencyKey: command.idempotencyKey ?? command.clientReferenceId,
      sourceAccountId: command.sourceLedgerAccountId,
      destAccountId: command.destLedgerAccountId,
      amount: command.amount,
      description: command.description,
      ...(command.metadata ? { metadata: command.metadata } : {}),
    });

    return {
      operationId: result.operationId,
      journalEntryId: result.journalEntryId,
      sourceAvailableCents: result.sourceAvailableBalance.amountCents,
      destAvailableCents: result.destAvailableBalance.amountCents,
      postedAt: result.postedAt,
      isIdempotentReplay: result.isIdempotentReplay,
    };
  }
}
