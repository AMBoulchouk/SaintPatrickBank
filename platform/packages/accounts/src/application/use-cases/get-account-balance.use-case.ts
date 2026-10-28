import { PaymentAccountRepository } from '../../domain/ports/payment-account.repository.interface.js';
import { LedgerReaderPort } from '../../domain/ports/ledger-reader.port.interface.js';
import { AccountBalanceDto, AuthContext } from '../dto/account.dto.js';
import {
  AccountNotFoundException,
  UnauthorizedAccountAccessException,
} from '../../domain/exceptions/account.exceptions.js';

export class GetAccountBalanceUseCase {
  constructor(
    private readonly accountRepository: PaymentAccountRepository,
    private readonly ledgerReader: LedgerReaderPort,
  ) {}

  async execute(accountId: string, auth: AuthContext): Promise<AccountBalanceDto> {
    const account = await this.accountRepository.findById(accountId);
    if (!account) {
      throw new AccountNotFoundException(accountId);
    }

    const isAuthorized =
      account.isOwnedBy(auth.subjectId) ||
      auth.roles.includes('ROLE_ADMIN') ||
      auth.roles.includes('ROLE_COMPLIANCE');

    if (!isAuthorized) {
      throw new UnauthorizedAccountAccessException(accountId, auth.subjectId);
    }

    // Notice: Delegates balance calculation exclusively to @spbk/ledger
    const snapshot = await this.ledgerReader.getAccountBalance(account.ledgerAccountId);

    const formatCurrency = (cents: bigint) => (Number(cents) / 100).toFixed(2);

    return {
      accountId: account.id,
      currency: snapshot.currency,
      availableCents: snapshot.availableCents.toString(),
      availableFormatted: formatCurrency(snapshot.availableCents),
      clearedCents: snapshot.clearedCents.toString(),
      clearedFormatted: formatCurrency(snapshot.clearedCents),
      reservedCents: snapshot.reservedCents.toString(),
      reservedFormatted: formatCurrency(snapshot.reservedCents),
      asOf: snapshot.asOf.toISOString(),
    };
  }
}
