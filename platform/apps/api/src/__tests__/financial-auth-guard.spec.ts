import { describe, it, expect, beforeEach } from 'vitest';
import { FinancialAuthGuard } from '../common/auth/auth.guard.js';
import {
  JwtTokenService,
  AuthenticatedPrincipal,
} from '@spbk/identity';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

describe('FinancialAuthGuard - Cryptographic Authentication & Anti-Spoofing', () => {
  const secretKey = 'test_financial_vault_secret_key_minimum_32_chars!';
  let tokenService: JwtTokenService;
  let guard: FinancialAuthGuard;

  beforeEach(() => {
    tokenService = new JwtTokenService({
      secretKey,
      issuer: 'saintpatrickbk-auth',
      audience: 'saintpatrickbk-api',
      defaultAccessTtlSeconds: 900,
    });
    guard = new FinancialAuthGuard(tokenService);
  });

  const createMockContext = (headers: Record<string, string | undefined>): { context: ExecutionContext; request: FastifyRequest } => {
    const request = { headers } as unknown as FastifyRequest;
    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
    return { context, request };
  };

  // ---------------------------------------------------------------------------
  // 1. Anti-Spoofing & Untrusted Header Rejection
  // ---------------------------------------------------------------------------
  describe('Anti-Spoofing Protection', () => {
    it('should reject request when X-User-Id header is present', async () => {
      const { context } = createMockContext({
        'x-user-id': 'spoofed-user-id',
        authorization: 'Bearer valid.mock.token',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(/Identity spoofing rejected/);
    });

    it('should reject request when X-User-Roles header is present', async () => {
      const { context } = createMockContext({
        'x-user-roles': 'ROLE_ADMIN',
        authorization: 'Bearer valid.mock.token',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(/Identity spoofing rejected/);
    });

    it('should reject request when X-Kyc-Status header is present', async () => {
      const { context } = createMockContext({
        'x-kyc-status': 'VERIFIED',
        authorization: 'Bearer valid.mock.token',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(/Identity spoofing rejected/);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Authorization Header Format & Scheme
  // ---------------------------------------------------------------------------
  describe('Authorization Header Validation', () => {
    it('should reject request when Authorization header is completely missing', async () => {
      const { context } = createMockContext({});

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(/Missing Bearer token/);
    });

    it('should reject request when Authorization scheme is not Bearer (e.g. Basic)', async () => {
      const { context } = createMockContext({
        authorization: 'Basic dXNlcjpwYXNz',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(/Authorization header must use Bearer scheme/);
    });

    it('should reject request when Bearer token is whitespace or empty', async () => {
      const { context } = createMockContext({
        authorization: 'Bearer   ',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(/Bearer token is empty/);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Cryptographic Token Integrity & Tamper Resistance
  // ---------------------------------------------------------------------------
  describe('Cryptographic Signature & Claims Verification', () => {
    it('should accept valid cryptographically signed token and populate request.user', async () => {
      const principal = new AuthenticatedPrincipal({
        id: '11111111-1111-1111-1111-111111111111',
        email: 'alice@saintpatrickbk.com',
        roles: ['ROLE_CUSTOMER'],
        kycStatus: 'VERIFIED',
        sessionId: 'session-123',
      });

      const token = await tokenService.createAccessToken(principal);
      const { context, request } = createMockContext({
        authorization: `Bearer ${token}`,
      });

      const canActivate = await guard.canActivate(context);
      expect(canActivate).toBe(true);
      expect(request.user).toBeDefined();
      expect(request.user?.id).toBe(principal.id);
      expect(request.user?.kycStatus).toBe('VERIFIED');
      expect(request.user?.roles).toContain('ROLE_CUSTOMER');
      expect((request.user as AuthenticatedPrincipal).email).toBe('alice@saintpatrickbk.com');
    });

    it('should reject token with tampered payload', async () => {
      const principal = new AuthenticatedPrincipal({
        id: '11111111-1111-1111-1111-111111111111',
        email: 'alice@saintpatrickbk.com',
        roles: ['ROLE_CUSTOMER'],
        kycStatus: 'PENDING',
      });

      const token = await tokenService.createAccessToken(principal);
      const parts = token.split('.');
      // Tamper with the payload (segment 1): elevate kycStatus to VERIFIED
      const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
      payload.kycStatus = 'VERIFIED';
      const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

      const { context } = createMockContext({
        authorization: `Bearer ${tamperedToken}`,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(/Cryptographic signature verification failed/);
    });

    it('should reject token signed by a different or unauthorized secret key', async () => {
      const rogueTokenService = new JwtTokenService({
        secretKey: 'attacker_controlled_unauthorized_key_min_32_chars!',
      });
      const principal = new AuthenticatedPrincipal({
        id: '22222222-2222-2222-2222-222222222222',
        email: 'attacker@evil.com',
        roles: ['ROLE_ADMIN'],
        kycStatus: 'VERIFIED',
      });

      const forgedToken = await rogueTokenService.createAccessToken(principal);
      const { context } = createMockContext({
        authorization: `Bearer ${forgedToken}`,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(/Cryptographic signature verification failed/);
    });

    it('should reject expired access tokens', async () => {
      const principal = new AuthenticatedPrincipal({
        id: '11111111-1111-1111-1111-111111111111',
        email: 'alice@saintpatrickbk.com',
        roles: ['ROLE_CUSTOMER'],
        kycStatus: 'VERIFIED',
      });

      // Token with TTL of -10 seconds (already expired)
      const expiredToken = await tokenService.createAccessToken(principal, -10);
      const { context } = createMockContext({
        authorization: `Bearer ${expiredToken}`,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(/Token expired at/);
    });

    it('should reject token when issuer does not match saintpatrickbk-auth', async () => {
      const foreignService = new JwtTokenService({
        secretKey,
        issuer: 'foreign-auth-service',
      });
      const principal = new AuthenticatedPrincipal({
        id: '11111111-1111-1111-1111-111111111111',
        email: 'alice@saintpatrickbk.com',
        roles: ['ROLE_CUSTOMER'],
        kycStatus: 'VERIFIED',
      });

      const foreignToken = await foreignService.createAccessToken(principal);
      const { context } = createMockContext({
        authorization: `Bearer ${foreignToken}`,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(/Issuer mismatch/);
    });

    it('should reject token when audience does not match saintpatrickbk-api', async () => {
      const foreignService = new JwtTokenService({
        secretKey,
        audience: 'other-service-api',
      });
      const principal = new AuthenticatedPrincipal({
        id: '11111111-1111-1111-1111-111111111111',
        email: 'alice@saintpatrickbk.com',
        roles: ['ROLE_CUSTOMER'],
        kycStatus: 'VERIFIED',
      });

      const foreignToken = await foreignService.createAccessToken(principal);
      const { context } = createMockContext({
        authorization: `Bearer ${foreignToken}`,
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(/Audience mismatch/);
    });

    it('should reject malformed token strings', async () => {
      const { context } = createMockContext({
        authorization: 'Bearer not.a.valid.jwt.string.with.too.many.dots',
      });

      await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
      await expect(guard.canActivate(context)).rejects.toThrow(/Malformed JWT/);
    });
  });
});
