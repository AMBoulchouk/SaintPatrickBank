import { PaymentAccount, AccountStatus } from '../entities/payment-account.js';

export interface PaymentAccountRepository {
  findById(id: string): Promise<PaymentAccount | null>;
  findByCustomerId(customerId: string): Promise<readonly PaymentAccount[]>;
  findByCvu(cvu: string): Promise<PaymentAccount | null>;
  findByAlias(alias: string): Promise<PaymentAccount | null>;
  findByLedgerAccountId(ledgerAccountId: string): Promise<PaymentAccount | null>;
  save(account: PaymentAccount): Promise<void>;
  updateStatus(id: string, status: AccountStatus): Promise<void>;
}
