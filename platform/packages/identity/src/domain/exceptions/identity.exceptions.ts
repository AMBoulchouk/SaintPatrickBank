export class InvalidCredentialsException extends Error {
  constructor() {
    // Deliberately generic message to prevent account enumeration
    super('Invalid email or credentials provided');
    this.name = 'InvalidCredentialsException';
  }
}

export class AccountLockedException extends Error {
  constructor(readonly lockedUntil: Date) {
    super(`Account is temporarily locked until ${lockedUntil.toISOString()} due to excessive failed attempts`);
    this.name = 'AccountLockedException';
  }
}

export class UserNotFoundException extends Error {
  constructor(identifier: string) {
    super(`User not found for identifier '${identifier}'`);
    this.name = 'UserNotFoundException';
  }
}

export class EmailAlreadyRegisteredException extends Error {
  constructor(email: string) {
    super(`Email address '${email}' is already registered`);
    this.name = 'EmailAlreadyRegisteredException';
  }
}

export class TaxIdAlreadyRegisteredException extends Error {
  constructor(taxId: string) {
    super(`Tax identification (CUIT/CUIL) '${taxId}' is already registered`);
    this.name = 'TaxIdAlreadyRegisteredException';
  }
}

export class SessionExpiredException extends Error {
  constructor(sessionId: string) {
    super(`Session '${sessionId}' has expired`);
    this.name = 'SessionExpiredException';
  }
}

export class SessionRevokedException extends Error {
  constructor(sessionId: string) {
    super(`Session '${sessionId}' has been revoked`);
    this.name = 'SessionRevokedException';
  }
}

export class TokenReuseDetectedException extends Error {
  constructor(sessionFamilyId: string) {
    super(`Security breach: Refresh token reuse detected for session family '${sessionFamilyId}'. All associated sessions have been revoked.`);
    this.name = 'TokenReuseDetectedException';
  }
}

export class InvalidTokenException extends Error {
  constructor(reason: string) {
    super(`Cryptographic token validation failed: ${reason}`);
    this.name = 'InvalidTokenException';
  }
}

export class MfaRequiredException extends Error {
  constructor(readonly challengeType: 'TOTP' | 'PASSKEY') {
    super(`Multi-Factor Authentication required with challenge type: ${challengeType}`);
    this.name = 'MfaRequiredException';
  }
}

export class UserNotActiveException extends Error {
  constructor(userId: string, status: string) {
    super(`User '${userId}' is not active (current status: '${status}')`);
    this.name = 'UserNotActiveException';
  }
}
