/**
 * Domain Exceptions for Accounts Bounded Context (@spbk/accounts)
 */

export class AccountNotFoundException extends Error {
  readonly code = 'ACCOUNT_NOT_FOUND';
  constructor(accountId: string) {
    super(`Payment account not found: '${accountId}'`);
    this.name = 'AccountNotFoundException';
  }
}

export class UnauthorizedAccountAccessException extends Error {
  readonly code = 'FORBIDDEN_ACCOUNT_ACCESS';
  constructor(accountId: string, customerId: string) {
    super(`Customer '${customerId}' is not authorized to access or operate account '${accountId}'`);
    this.name = 'UnauthorizedAccountAccessException';
  }
}

export class AccountNotActiveException extends Error {
  readonly code = 'ACCOUNT_NOT_ACTIVE';
  constructor(accountId: string, status: string) {
    super(`Account '${accountId}' is not in ACTIVE status (current: ${status}). Outgoing operations are restricted.`);
    this.name = 'AccountNotActiveException';
  }
}

export class AccountCannotReceiveException extends Error {
  readonly code = 'ACCOUNT_CANNOT_RECEIVE';
  constructor(accountId: string, status: string) {
    super(`Destination account '${accountId}' cannot receive transfers (current status: ${status}).`);
    this.name = 'AccountCannotReceiveException';
  }
}

export class SingleTransferLimitExceededException extends Error {
  readonly code = 'LIMIT_EXCEEDED';
  constructor(requestedCents: bigint, limitCents: bigint) {
    super(`Transfer amount ${requestedCents} exceeds maximum permitted single transaction limit of ${limitCents} cents.`);
    this.name = 'SingleTransferLimitExceededException';
  }
}

export class InsufficientKycLevelException extends Error {
  readonly code = 'INSUFFICIENT_KYC_LEVEL';
  constructor(customerId: string, status: string) {
    super(`Customer '${customerId}' does not possess verified KYC status (current: ${status}). Financial transfers require verified KYC.`);
    this.name = 'InsufficientKycLevelException';
  }
}

export class CurrencyMismatchException extends Error {
  readonly code = 'CURRENCY_MISMATCH';
  constructor(sourceCurrency: string, destCurrency: string) {
    super(`Currency mismatch: source account operates in ${sourceCurrency} while destination operates in ${destCurrency}.`);
    this.name = 'CurrencyMismatchException';
  }
}

export class InvalidTransferAmountException extends Error {
  readonly code = 'INVALID_TRANSFER_AMOUNT';
  constructor(cents: bigint) {
    super(`Transfer amount must be strictly positive (received: ${cents} cents).`);
    this.name = 'InvalidTransferAmountException';
  }
}
