import { AuthenticatedPrincipal } from '../value-objects/authenticated-principal.vo.js';

export interface TokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresInSeconds: number;
  readonly tokenType: 'Bearer';
}

export interface GeneratedRefreshToken {
  readonly token: string;
  readonly hash: string;
}

export interface TokenService {
  createAccessToken(principal: AuthenticatedPrincipal, expiresInSeconds?: number): Promise<string>;
  createRefreshToken(): GeneratedRefreshToken;
  verifyAccessToken(rawToken: string): Promise<AuthenticatedPrincipal>;
  hashRefreshToken(rawToken: string): string;
}
