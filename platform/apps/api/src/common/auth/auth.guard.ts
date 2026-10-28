import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  Inject,
  Optional,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import {
  type TokenService,
  JwtTokenService,
  AuthenticatedPrincipal,
} from '@spbk/identity';

export const TOKEN_SERVICE_TOKEN = 'TOKEN_SERVICE_TOKEN';

@Injectable()
export class FinancialAuthGuard implements CanActivate {
  private readonly tokenService: TokenService;

  constructor(
    @Optional()
    @Inject(TOKEN_SERVICE_TOKEN)
    injectedTokenService?: TokenService,
  ) {
    if (injectedTokenService) {
      this.tokenService = injectedTokenService;
    } else {
      // Default production configuration from environment
      const secret = process.env.JWT_SECRET_KEY || 'default_financial_vault_secret_key_minimum_32_chars!';
      this.tokenService = new JwtTokenService({
        secretKey: secret,
        issuer: process.env.JWT_ISSUER || 'saintpatrickbk-auth',
        audience: process.env.JWT_AUDIENCE || 'saintpatrickbk-api',
      });
    }
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    // 1. Inviolate Security: Strictly forbid and block any header spoofing attempt
    if (
      request.headers['x-user-id'] !== undefined ||
      request.headers['x-user-roles'] !== undefined ||
      request.headers['x-kyc-status'] !== undefined
    ) {
      throw new UnauthorizedException(
        'Identity spoofing rejected. Arbitrary identity headers (X-User-Id, X-User-Roles, X-Kyc-Status) are strictly prohibited.',
      );
    }

    // 2. Extract Authorization Bearer header
    const authHeader = request.headers['authorization'];
    if (!authHeader || typeof authHeader !== 'string') {
      throw new UnauthorizedException('Authentication required. Missing Bearer token.');
    }

    const trimmed = authHeader.trim();
    if (!trimmed.toLowerCase().startsWith('bearer')) {
      throw new UnauthorizedException('Authentication required. Authorization header must use Bearer scheme.');
    }

    const rawToken = trimmed.substring(6).trim();
    if (!rawToken) {
      throw new UnauthorizedException('Authentication required. Bearer token is empty.');
    }

    // 3. Cryptographically verify signature, algorithm, exp, nbf, iss, aud
    let principal: AuthenticatedPrincipal;
    try {
      principal = await this.tokenService.verifyAccessToken(rawToken);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Invalid or expired token';
      throw new UnauthorizedException(`Cryptographic token validation failed: ${message}`);
    }

    // 4. Attach verified principal to request context
    request.user = principal;
    return true;
  }
}
