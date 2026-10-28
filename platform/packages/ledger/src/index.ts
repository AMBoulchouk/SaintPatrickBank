/**
 * @spbk/ledger - Core Financial Ledger Package
 * High-Integrity Double-Entry Accounting Core for SaintPatrickBK
 */

export * from './domain/entities/ledger-account.js';
export * from './domain/entities/account-balance.js';
export * from './domain/entities/financial-operation.js';
export * from './domain/entities/funds-reservation.js';
export * from './domain/entities/journal-entry.js';
export * from './domain/entities/journal-line.js';

export * from './domain/repositories/ledger.repository.interface.js';
export * from './domain/repositories/funds-reservation.repository.interface.js';
export * from './domain/repositories/financial-operation.repository.interface.js';

export * from './infrastructure/repositories/postgres-ledger.repository.js';
export * from './infrastructure/repositories/postgres-funds-reservation.repository.js';

export * from './application/use-cases/post-transfer.use-case.js';
export * from './application/use-cases/create-reservation.use-case.js';
export * from './application/use-cases/settle-reservation.use-case.js';
export * from './application/use-cases/release-reservation.use-case.js';

export * from './migrations/runner.js';

export const LEDGER_CONSTANTS = {
  CANONICAL_ASSET_SIGHT_ACCOUNT: '1101',
  CANONICAL_CUSTOMER_LIABILITY_ACCOUNT: '2101',
  CANONICAL_IN_FLIGHT_RESERVED_ACCOUNT: '2102',
} as const;
