import { PaymentAccountRepository } from '../../domain/ports/payment-account.repository.interface.js';
import {
  LedgerReaderPort,
  PaginationOptions,
} from '../../domain/ports/ledger-reader.port.interface.js';
import { PaginatedTransactionsDto, AuthContext } from '../dto/account.dto.js';
import {
  AccountNotFoundException,
  UnauthorizedAccountAccessException,
} from '../../domain/exceptions/account.exceptions.js';

export class GetAccountTransactionsUseCase {
  constructor(
    private readonly accountRepository: PaymentAccountRepository,
    private readonly ledgerReader: LedgerReaderPort,
  ) {}

  async execute(
    accountId: string,
    options: PaginationOptions,
    auth: AuthContext,
  ): Promise<PaginatedTransactionsDto> {
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

    const snapshot = await this.ledgerReader.getTransactionHistory(
      account.ledgerAccountId,
      options,
    );

    const formatCurrency = (cents: bigint) => (Number(cents) / 100).toFixed(2);

    return {
      items: snapshot.items.map((item) => ({
        id: item.id,
        entryNumber: item.entryNumber,
        direction: item.direction,
        amountCents: item.amountCents.toString(),
        amountFormatted: formatCurrency(item.amountCents),
        currency: item.currency,
        description: item.description,
        postedAt: item.postedAt.toISOString(),
      })),
      total: snapshot.total,
      limit: snapshot.limit,
      offset: snapshot.offset,
    };
  }
}
