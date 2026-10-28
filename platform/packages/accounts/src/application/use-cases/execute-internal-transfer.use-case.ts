import { PaymentAccountRepository } from '../../domain/ports/payment-account.repository.interface.js';
import { FinancialTransferPort } from '../../domain/ports/financial-transfer.port.interface.js';
import {
  InitiateTransferCommand,
  TransferReceiptDto,
  AuthContext,
} from '../dto/account.dto.js';
import {
  AccountNotFoundException,
  UnauthorizedAccountAccessException,
  InsufficientKycLevelException,
  CurrencyMismatchException,
  InvalidTransferAmountException,
} from '../../domain/exceptions/account.exceptions.js';
import { PaymentAccount } from '../../domain/entities/payment-account.js';

export class ExecuteInternalTransferUseCase {
  constructor(
    private readonly accountRepository: PaymentAccountRepository,
    private readonly financialTransferPort: FinancialTransferPort,
  ) {}

  async execute(
    command: InitiateTransferCommand,
    auth: AuthContext,
  ): Promise<TransferReceiptDto> {
    // 1. Mandatory Identity & Compliance Check (SCA / KYC verification)
    if (auth.kycStatus !== 'VERIFIED') {
      throw new InsufficientKycLevelException(auth.subjectId, auth.kycStatus);
    }

    // 2. Validate Transfer Amount
    if (command.amount.amountCents <= 0n) {
      throw new InvalidTransferAmountException(command.amount.amountCents);
    }

    // 3. Resolve and Authorize Source Account
    const sourceAccount = await this.accountRepository.findById(command.sourceAccountId);
    if (!sourceAccount) {
      throw new AccountNotFoundException(command.sourceAccountId);
    }

    // Never trust client-provided claims: verify authenticated subject owns the source account
    if (!sourceAccount.isOwnedBy(auth.subjectId)) {
      throw new UnauthorizedAccountAccessException(sourceAccount.id, auth.subjectId);
    }

    // Verify operational status & single transaction limit
    sourceAccount.assertCanTransact();
    sourceAccount.assertWithinSingleLimit(command.amount.amountCents);

    // 4. Resolve Destination Account (Supports Account UUID, 22-digit CVU, or Alias)
    const destinationAccount = await this.resolveDestination(command.destinationIdentifier);
    if (!destinationAccount) {
      throw new AccountNotFoundException(command.destinationIdentifier);
    }

    // Prohibit self-transfers to identical accounts
    if (sourceAccount.id === destinationAccount.id) {
      throw new Error(
        `Source and destination payment accounts cannot be identical: '${sourceAccount.id}'`,
      );
    }

    // Verify destination status (cannot be BLOCKED or CLOSED)
    destinationAccount.assertCanReceive();

    // Verify currency homogeneity
    if (sourceAccount.currency !== destinationAccount.currency) {
      throw new CurrencyMismatchException(
        sourceAccount.currency,
        destinationAccount.currency,
      );
    }

    // 5. Post through FinancialTransferPort (Delegates exclusively to Ledger Core)
    const transferResult = await this.financialTransferPort.executeInternalTransfer({
      clientReferenceId: command.clientReferenceId,
      idempotencyKey: command.idempotencyKey,
      sourceLedgerAccountId: sourceAccount.ledgerAccountId,
      destLedgerAccountId: destinationAccount.ledgerAccountId,
      amount: command.amount,
      description: command.description,
      metadata: {
        ...command.metadata,
        sourcePaymentAccountId: sourceAccount.id,
        destPaymentAccountId: destinationAccount.id,
        initiatedByCustomer: auth.subjectId,
      },
    });

    const formatCurrency = (cents: bigint) => (Number(cents) / 100).toFixed(2);

    return {
      operationId: transferResult.operationId,
      journalEntryId: transferResult.journalEntryId,
      clientReferenceId: command.clientReferenceId,
      sourceAccountId: sourceAccount.id,
      destinationAccountId: destinationAccount.id,
      amountCents: command.amount.amountCents.toString(),
      amountFormatted: formatCurrency(command.amount.amountCents),
      currency: command.amount.currency,
      status: 'CONFIRMED',
      isIdempotentReplay: transferResult.isIdempotentReplay,
      postedAt: transferResult.postedAt.toISOString(),
    };
  }

  private async resolveDestination(identifier: string): Promise<PaymentAccount | null> {
    const trimmed = identifier.trim();

    // UUID format check
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
    if (isUuid) {
      const byId = await this.accountRepository.findById(trimmed);
      if (byId) return byId;
    }

    // 22 numeric digits -> CVU
    if (/^\d{22}$/.test(trimmed)) {
      return this.accountRepository.findByCvu(trimmed);
    }

    // Otherwise -> Account Alias
    return this.accountRepository.findByAlias(trimmed.toLowerCase());
  }
}
