import { PaymentAccountRepository } from '../../domain/ports/payment-account.repository.interface.js';
import { PaymentAccountDto, AuthContext } from '../dto/account.dto.js';
import {
  AccountNotFoundException,
  UnauthorizedAccountAccessException,
} from '../../domain/exceptions/account.exceptions.js';

export class GetAccountUseCase {
  constructor(private readonly accountRepository: PaymentAccountRepository) {}

  async execute(accountId: string, auth: AuthContext): Promise<PaymentAccountDto> {
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

    return {
      id: account.id,
      customerId: account.customerId,
      accountNumber: account.accountNumber,
      cvu: account.cvu.value,
      alias: account.alias.value,
      currency: account.currency,
      status: account.status,
      dailyTransferLimit: account.dailyTransferLimitCents.toString(),
      singleTransferLimit: account.singleTransferLimitCents.toString(),
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    };
  }
}
