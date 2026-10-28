/**
 * @spbk/identity - Domain Contracts & Types
 * Authentication, Session Security, and MFA (TOTP / WebAuthn).
 */

export interface UserCredentialsDescriptor {
  readonly userId: string;
  readonly email: string;
  readonly isMfaEnrolled: boolean;
  readonly lastLoginAt?: string;
}

export type AuthenticationChallengeType = 'PASSWORD' | 'TOTP' | 'BIOMETRIC_PASSKEY';
