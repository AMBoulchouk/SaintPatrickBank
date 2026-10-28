export type KycVerificationStatus = 'PENDING' | 'VERIFIED' | 'REJECTED';
export type UserLifecycleStatus = 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'BLOCKED';

export interface AuthenticatedPrincipalProps {
  readonly id: string;
  readonly email: string;
  readonly roles: readonly string[];
  readonly kycStatus: KycVerificationStatus;
  readonly sessionId?: string | undefined;
  readonly tokenId?: string | undefined;
  readonly isMfaVerified?: boolean | undefined;
}

/**
 * Value Object: AuthenticatedPrincipal
 * Represents an immutable, cryptographically verified security principal.
 * Cannot be constructed from arbitrary, untrusted HTTP headers.
 */
export class AuthenticatedPrincipal {
  readonly id: string;
  readonly email: string;
  readonly roles: readonly string[];
  readonly kycStatus: KycVerificationStatus;
  readonly sessionId?: string | undefined;
  readonly tokenId?: string | undefined;
  readonly isMfaVerified: boolean;

  constructor(props: AuthenticatedPrincipalProps) {
    if (!props.id || !props.id.trim()) {
      throw new Error('Authenticated principal must have a valid non-empty subject ID');
    }
    if (!props.email || !props.email.trim()) {
      throw new Error('Authenticated principal must have a valid non-empty email');
    }

    this.id = props.id.trim();
    this.email = props.email.trim().toLowerCase();
    this.roles = Object.freeze([...(props.roles ?? [])]);
    this.kycStatus = props.kycStatus;
    this.sessionId = props.sessionId;
    this.tokenId = props.tokenId;
    this.isMfaVerified = props.isMfaVerified ?? false;
    Object.freeze(this);
  }

  hasRole(role: string): boolean {
    return this.roles.includes(role);
  }

  isKycVerified(): boolean {
    return this.kycStatus === 'VERIFIED';
  }

  /**
   * Returns a new principal instance reflecting a newly verified, live KYC status from the database.
   */
  withLiveKycStatus(liveStatus: KycVerificationStatus): AuthenticatedPrincipal {
    return new AuthenticatedPrincipal({
      id: this.id,
      email: this.email,
      roles: this.roles,
      kycStatus: liveStatus,
      sessionId: this.sessionId,
      tokenId: this.tokenId,
      isMfaVerified: this.isMfaVerified,
    });
  }
}
