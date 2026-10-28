export interface RegisterUserCommand {
  readonly email: string;
  readonly password: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly taxId: string; // CUIT/CUIL
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly correlationId?: string;
}

export interface AuthenticateUserCommand {
  readonly email: string;
  readonly password: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly deviceFingerprint?: string;
  readonly correlationId?: string;
}

export interface RefreshTokenCommand {
  readonly refreshToken: string;
  readonly ipAddress: string;
  readonly userAgent?: string;
  readonly deviceFingerprint?: string;
  readonly correlationId?: string;
}

export interface RevokeSessionCommand {
  readonly sessionId?: string;
  readonly userId?: string;
  readonly revokeAll?: boolean;
  readonly ipAddress: string;
  readonly correlationId?: string;
}

export interface AuthTokensDto {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
  readonly tokenType: 'Bearer';
  readonly user: {
    readonly id: string;
    readonly email: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly taxId: string;
    readonly status: string;
    readonly kycStatus: string;
    readonly isMfaEnabled: boolean;
  };
}

export interface UserProfileDto {
  readonly id: string;
  readonly email: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly taxId: string;
  readonly status: string;
  readonly kycStatus: string;
  readonly isMfaEnabled: boolean;
  readonly createdAt: string;
}
