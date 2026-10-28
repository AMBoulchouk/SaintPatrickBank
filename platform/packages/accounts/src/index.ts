/**
 * @spbk/accounts - Accounts Bounded Context
 * Virtual Payment Accounts & CVU Lifecycle Management for SaintPatrickBK
 */

// Entities & Value Objects
export * from './domain/entities/payment-account.js';
export * from './domain/value-objects/cvu.js';
export * from './domain/value-objects/account-alias.js';
export * from './domain/exceptions/account.exceptions.js';

// Ports
export * from './domain/ports/payment-account.repository.interface.js';
export * from './domain/ports/ledger-reader.port.interface.js';
export * from './domain/ports/financial-transfer.port.interface.js';

// DTOs & Commands
export * from './application/dto/account.dto.js';

// Use Cases
export * from './application/use-cases/get-account.use-case.js';
export * from './application/use-cases/list-customer-accounts.use-case.js';
export * from './application/use-cases/get-account-balance.use-case.js';
export * from './application/use-cases/get-account-transactions.use-case.js';
export * from './application/use-cases/execute-internal-transfer.use-case.js';

// Infrastructure
export * from './infrastructure/repositories/postgres-payment-account.repository.js';
export * from './infrastructure/adapters/postgres-ledger-reader.adapter.js';
export * from './infrastructure/adapters/ledger-transfer.adapter.js';
