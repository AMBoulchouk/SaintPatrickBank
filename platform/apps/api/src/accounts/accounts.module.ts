import { Module } from '@nestjs/common';
import type { DatabasePool } from '@spbk/infrastructure';
import { AccountsController } from './accounts.controller.js';
import { TransfersController } from './transfers.controller.js';
import {
  PostgresPaymentAccountRepository,
  PostgresLedgerReaderAdapter,
  LedgerTransferAdapter,
  GetAccountUseCase,
  ListCustomerAccountsUseCase,
  GetAccountBalanceUseCase,
  GetAccountTransactionsUseCase,
  ExecuteInternalTransferUseCase,
} from '@spbk/accounts';
import {
  PostgresLedgerRepository,
  PostTransferUseCase,
} from '@spbk/ledger';

@Module({
  controllers: [AccountsController, TransfersController],
  providers: [
    {
      provide: 'PAYMENT_ACCOUNT_REPOSITORY',
      useFactory: (pool: DatabasePool) => new PostgresPaymentAccountRepository(pool),
      inject: ['DATABASE_POOL'],
    },
    {
      provide: 'LEDGER_READER_PORT',
      useFactory: (pool: DatabasePool) => new PostgresLedgerReaderAdapter(pool),
      inject: ['DATABASE_POOL'],
    },
    {
      provide: 'LEDGER_REPOSITORY',
      useFactory: (pool: DatabasePool) => new PostgresLedgerRepository(pool),
      inject: ['DATABASE_POOL'],
    },
    {
      provide: PostTransferUseCase,
      useFactory: (ledgerRepo: PostgresLedgerRepository) => new PostTransferUseCase(ledgerRepo),
      inject: ['LEDGER_REPOSITORY'],
    },
    {
      provide: 'FINANCIAL_TRANSFER_PORT',
      useFactory: (postTransferUseCase: PostTransferUseCase) =>
        new LedgerTransferAdapter(postTransferUseCase),
      inject: [PostTransferUseCase],
    },
    {
      provide: GetAccountUseCase,
      useFactory: (accountRepo: PostgresPaymentAccountRepository) =>
        new GetAccountUseCase(accountRepo),
      inject: ['PAYMENT_ACCOUNT_REPOSITORY'],
    },
    {
      provide: ListCustomerAccountsUseCase,
      useFactory: (accountRepo: PostgresPaymentAccountRepository) =>
        new ListCustomerAccountsUseCase(accountRepo),
      inject: ['PAYMENT_ACCOUNT_REPOSITORY'],
    },
    {
      provide: GetAccountBalanceUseCase,
      useFactory: (
        accountRepo: PostgresPaymentAccountRepository,
        ledgerReader: PostgresLedgerReaderAdapter,
      ) => new GetAccountBalanceUseCase(accountRepo, ledgerReader),
      inject: ['PAYMENT_ACCOUNT_REPOSITORY', 'LEDGER_READER_PORT'],
    },
    {
      provide: GetAccountTransactionsUseCase,
      useFactory: (
        accountRepo: PostgresPaymentAccountRepository,
        ledgerReader: PostgresLedgerReaderAdapter,
      ) => new GetAccountTransactionsUseCase(accountRepo, ledgerReader),
      inject: ['PAYMENT_ACCOUNT_REPOSITORY', 'LEDGER_READER_PORT'],
    },
    {
      provide: ExecuteInternalTransferUseCase,
      useFactory: (
        accountRepo: PostgresPaymentAccountRepository,
        transferPort: LedgerTransferAdapter,
      ) => new ExecuteInternalTransferUseCase(accountRepo, transferPort),
      inject: ['PAYMENT_ACCOUNT_REPOSITORY', 'FINANCIAL_TRANSFER_PORT'],
    },
  ],
  exports: [
    GetAccountUseCase,
    ListCustomerAccountsUseCase,
    GetAccountBalanceUseCase,
    GetAccountTransactionsUseCase,
    ExecuteInternalTransferUseCase,
  ],
})
export class AccountsModule {}
