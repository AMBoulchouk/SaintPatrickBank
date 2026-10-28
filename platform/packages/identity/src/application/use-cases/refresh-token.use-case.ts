import * as crypto from 'node:crypto';
import { UserRepository } from '../../domain/ports/user.repository.interface.js';
import { UserSessionRepository } from '../../domain/ports/user-session.repository.interface.js';
import { AuthAuditLogRepository } from '../../domain/ports/auth-audit-log.repository.interface.js';
import { TokenService } from '../../domain/ports/token-service.interface.js';
import { AuthenticatedPrincipal } from '../../domain/value-objects/authenticated-principal.vo.js';
import { UserSession } from '../../domain/entities/user-session.entity.js';
import {
  RefreshTokenCommand,
  AuthTokensDto,
} from '../dto/auth.dto.js';
import {
  InvalidTokenException,
  SessionExpiredException,
  SessionRevokedException,
  TokenReuseDetectedException,
  UserNotActiveException,
  UserNotFoundException,
} from '../../domain/exceptions/identity.exceptions.js';

export class RefreshTokenUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly sessionRepository: UserSessionRepository,
    private readonly auditLogRepository: AuthAuditLogRepository,
    private readonly tokenService: TokenService,
  ) {}

  async execute(command: RefreshTokenCommand): Promise<AuthTokensDto> {
    if (!command.refreshToken || !command.refreshToken.trim()) {
      throw new InvalidTokenException('Refresh token is required');
    }

    const tokenHash = this.tokenService.hashRefreshToken(command.refreshToken);
    const existingSession = await this.sessionRepository.findByRefreshTokenHash(tokenHash);

    if (!existingSession) {
      throw new InvalidTokenException('Refresh token unrecognized or expired from session store');
    }

    // 1. REUSE DETECTION: If an already used refresh token is presented, REVOKE ENTIRE FAMILY
    if (existingSession.isUsed) {
      await this.sessionRepository.revokeAllForFamily(existingSession.sessionFamilyId);

      await this.auditLogRepository.record({
        userId: existingSession.userId,
        eventType: 'TOKEN_REUSE_DETECTED',
        ipAddress: command.ipAddress,
        userAgent: command.userAgent,
        correlationId: command.correlationId,
        metadata: {
          sessionFamilyId: existingSession.sessionFamilyId,
          reusedSessionId: existingSession.id,
        },
      });

      throw new TokenReuseDetectedException(existingSession.sessionFamilyId);
    }

    // 2. Check Revocation
    if (existingSession.isRevoked()) {
      throw new SessionRevokedException(existingSession.id);
    }

    // 3. Check Expiration
    if (existingSession.isExpired()) {
      throw new SessionExpiredException(existingSession.id);
    }

    // 4. Check User Status
    const user = await this.userRepository.findById(existingSession.userId);
    if (!user) {
      throw new UserNotFoundException(existingSession.userId);
    }

    if (user.status === 'BLOCKED' || user.status === 'SUSPENDED') {
      throw new UserNotActiveException(user.id, user.status);
    }

    // 5. Rotate: Mark current session as used
    existingSession.markUsed();
    await this.sessionRepository.save(existingSession);

    // 6. Generate new refresh token and new session in the SAME family
    const newSessionId = crypto.randomUUID();
    const newRefreshTokenData = this.tokenService.createRefreshToken();
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const nextSession = new UserSession({
      id: newSessionId,
      userId: user.id,
      refreshTokenHash: newRefreshTokenData.hash,
      sessionFamilyId: existingSession.sessionFamilyId, // Preserve family
      deviceFingerprint: command.deviceFingerprint ?? existingSession.deviceFingerprint,
      ipAddress: command.ipAddress,
      userAgent: command.userAgent ?? existingSession.userAgent,
      expiresAt: newExpiresAt,
    });

    await this.sessionRepository.save(nextSession);

    // 7. Issue new Access Token (15 mins)
    const principal = new AuthenticatedPrincipal({
      id: user.id,
      email: user.email.value,
      roles: ['ROLE_CUSTOMER'],
      kycStatus: user.kycStatus,
      sessionId: nextSession.id,
    });

    const newAccessToken = await this.tokenService.createAccessToken(principal, 900);

    await this.auditLogRepository.record({
      userId: user.id,
      email: user.email.value,
      eventType: 'TOKEN_REFRESH',
      ipAddress: command.ipAddress,
      userAgent: command.userAgent,
      correlationId: command.correlationId,
      metadata: {
        oldSessionId: existingSession.id,
        newSessionId: nextSession.id,
        sessionFamilyId: existingSession.sessionFamilyId,
      },
    });

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshTokenData.token,
      expiresInSeconds: 900,
      tokenType: 'Bearer',
      user: {
        id: user.id,
        email: user.email.value,
        firstName: user.firstName,
        lastName: user.lastName,
        taxId: user.taxId,
        status: user.status,
        kycStatus: user.kycStatus,
        isMfaEnabled: user.isMfaEnabled,
      },
    };
  }
}
