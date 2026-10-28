import { PaymentAccountRepository } from '../../domain/ports/payment-account.repository.interface.js';
import { PaymentAccountDto, AuthContext } from '../dto/account.dto.js';

export class ListCustomerAccountsUseCase {
  constructor(private readonly accountRepository: PaymentAccountRepository) {}

  async execute(auth: AuthContext): Promise<readonly PaymentAccountDto[]> {
    const accounts = await this.accountRepository.findByCustomerId(auth.subjectId);

    return accounts.map((account) => ({
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
    }));
  }
}
