/**
 * @spbk/identity - Bounded Context: Identity & Access Management
 * Cryptographic authentication, Argon2id credentials, session security, and token rotation.
 */

// Value Objects
export * from './domain/value-objects/email.vo.js';
export * from './domain/value-objects/password-hash.vo.js';
export * from './domain/value-objects/authenticated-principal.vo.js';

// Entities
export * from './domain/entities/user.entity.js';
export * from './domain/entities/user-session.entity.js';

// Domain Exceptions
export * from './domain/exceptions/identity.exceptions.js';

// Ports
export * from './domain/ports/user.repository.interface.js';
export * from './domain/ports/user-session.repository.interface.js';
export * from './domain/ports/auth-audit-log.repository.interface.js';
export * from './domain/ports/token-service.interface.js';
export * from './domain/ports/customer-status.port.interface.js';

// Application DTOs & Use Cases
export * from './application/dto/auth.dto.js';
export * from './application/use-cases/register-user.use-case.js';
export * from './application/use-cases/authenticate-user.use-case.js';
export * from './application/use-cases/refresh-token.use-case.js';
export * from './application/use-cases/revoke-session.use-case.js';

// Infrastructure (Crypto & Repositories)
export * from './infrastructure/crypto/jwt-token-service.js';
export * from './infrastructure/repositories/pg-user.repository.js';
export * from './infrastructure/repositories/pg-user-session.repository.js';
export * from './infrastructure/repositories/pg-auth-audit-log.repository.js';
export * from './infrastructure/adapters/pg-customer-status.adapter.js';
