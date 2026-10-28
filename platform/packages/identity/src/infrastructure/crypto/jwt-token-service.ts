import * as crypto from 'node:crypto';
import {
  TokenService,
  GeneratedRefreshToken,
} from '../../domain/ports/token-service.interface.js';
import {
  AuthenticatedPrincipal,
  KycVerificationStatus,
} from '../../domain/value-objects/authenticated-principal.vo.js';
import { InvalidTokenException } from '../../domain/exceptions/identity.exceptions.js';

export interface JwtTokenServiceConfig {
  readonly secretKey: string;
  readonly previousSecretKeys?: readonly string[] | undefined;
  readonly issuer?: string | undefined;
  readonly audience?: string | undefined;
  readonly defaultAccessTtlSeconds?: number | undefined;
}

interface JwtHeader {
  readonly alg: 'HS256';
  readonly typ: 'JWT';
}

interface JwtPayload {
  readonly sub: string;
  readonly email: string;
  readonly roles: readonly string[];
  readonly kycStatus: KycVerificationStatus;
  readonly iss: string;
  readonly aud: string;
  readonly iat: number;
  readonly nbf: number;
  readonly exp: number;
  readonly jti: string;
  readonly sessionId?: string | undefined;
}

export class JwtTokenService implements TokenService {
  private readonly secretKey: string;
  private readonly previousSecretKeys: readonly string[];
  private readonly issuer: string;
  private readonly audience: string;
  private readonly defaultAccessTtlSeconds: number;

  constructor(config: JwtTokenServiceConfig) {
    if (!config.secretKey || config.secretKey.length < 32) {
      throw new Error('JWT Secret key must be at least 32 characters (256 bits) in length');
    }
    this.secretKey = config.secretKey;
    this.previousSecretKeys = config.previousSecretKeys ?? [];
    this.issuer = config.issuer ?? 'saintpatrickbk-auth';
    this.audience = config.audience ?? 'saintpatrickbk-api';
    this.defaultAccessTtlSeconds = config.defaultAccessTtlSeconds ?? 900; // 15 mins
  }

  async createAccessToken(
    principal: AuthenticatedPrincipal,
    expiresInSeconds = this.defaultAccessTtlSeconds,
  ): Promise<string> {
    const now = Math.floor(Date.now() / 1000);

    const header: JwtHeader = {
      alg: 'HS256',
      typ: 'JWT',
    };

    const payload: JwtPayload = {
      sub: principal.id,
      email: principal.email,
      roles: principal.roles,
      kycStatus: principal.kycStatus,
      iss: this.issuer,
      aud: this.audience,
      iat: now,
      nbf: now,
      exp: now + expiresInSeconds,
      jti: crypto.randomUUID(),
      ...(principal.sessionId ? { sessionId: principal.sessionId } : {}),
    };

    const encodedHeader = this.base64UrlEncode(JSON.stringify(header));
    const encodedPayload = this.base64UrlEncode(JSON.stringify(payload));
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    const signature = this.signHmacSha256(signingInput, this.secretKey);
    return `${signingInput}.${signature}`;
  }

  createRefreshToken(): GeneratedRefreshToken {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hash = this.hashRefreshToken(rawToken);
    return { token: rawToken, hash };
  }

  hashRefreshToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken.trim()).digest('hex');
  }

  async verifyAccessToken(rawToken: string): Promise<AuthenticatedPrincipal> {
    if (!rawToken || typeof rawToken !== 'string') {
      throw new InvalidTokenException('Token string is missing or invalid');
    }

    const parts = rawToken.split('.');
    if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) {
      throw new InvalidTokenException('Malformed JWT: must consist of 3 dot-separated segments');
    }

    const encodedHeader = parts[0];
    const encodedPayload = parts[1];
    const signature = parts[2];
    const signingInput = `${encodedHeader}.${encodedPayload}`;

    // 1. Validate Header & Algorithm strictly
    let header: JwtHeader;
    try {
      header = JSON.parse(this.base64UrlDecode(encodedHeader));
    } catch {
      throw new InvalidTokenException('Invalid token header encoding');
    }

    if (header.alg !== 'HS256' || header.typ !== 'JWT') {
      throw new InvalidTokenException(`Unsupported algorithm '${header.alg}' or token type '${header.typ}'`);
    }

    // 2. Validate Signature using active key, or previous keys for rotation
    const signatureBuffer = Buffer.from(signature, 'base64url');
    let isValidSignature = false;

    const candidateKeys = [this.secretKey, ...this.previousSecretKeys];
    for (const key of candidateKeys) {
      const expectedSig = this.signHmacSha256(signingInput, key);
      const expectedBuffer = Buffer.from(expectedSig, 'base64url');
      if (
        signatureBuffer.length === expectedBuffer.length &&
        crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
      ) {
        isValidSignature = true;
        break;
      }
    }

    if (!isValidSignature) {
      throw new InvalidTokenException('Cryptographic signature verification failed');
    }

    // 3. Parse and Validate Claims
    let payload: JwtPayload;
    try {
      payload = JSON.parse(this.base64UrlDecode(encodedPayload));
    } catch {
      throw new InvalidTokenException('Invalid token payload encoding');
    }

    const now = Math.floor(Date.now() / 1000);

    if (payload.iss !== this.issuer) {
      throw new InvalidTokenException(`Issuer mismatch: expected '${this.issuer}', got '${payload.iss}'`);
    }

    if (payload.aud !== this.audience) {
      throw new InvalidTokenException(`Audience mismatch: expected '${this.audience}', got '${payload.aud}'`);
    }

    if (payload.exp <= now) {
      throw new InvalidTokenException(`Token expired at ${new Date(payload.exp * 1000).toISOString()}`);
    }

    if (payload.nbf > now) {
      throw new InvalidTokenException(`Token not active before ${new Date(payload.nbf * 1000).toISOString()}`);
    }

    return new AuthenticatedPrincipal({
      id: payload.sub,
      email: payload.email,
      roles: payload.roles,
      kycStatus: payload.kycStatus,
      sessionId: payload.sessionId,
      tokenId: payload.jti,
      isMfaVerified: false,
    });
  }

  private signHmacSha256(data: string, secret: string): string {
    return crypto
      .createHmac('sha256', secret)
      .update(data)
      .digest('base64url');
  }

  private base64UrlEncode(data: string): string {
    return Buffer.from(data, 'utf8').toString('base64url');
  }

  private base64UrlDecode(data: string): string {
    return Buffer.from(data, 'base64url').toString('utf8');
  }
}
