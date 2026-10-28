import * as crypto from 'node:crypto';
import { UserRepository } from '../../domain/ports/user.repository.interface.js';
import { UserSessionRepository } from '../../domain/ports/user-session.repository.interface.js';
import { AuthAuditLogRepository } from '../../domain/ports/auth-audit-log.repository.interface.js';
import { TokenService } from '../../domain/ports/token-service.interface.js';
import { Email } from '../../domain/value-objects/email.vo.js';
import { AuthenticatedPrincipal } from '../../domain/value-objects/authenticated-principal.vo.js';
import { UserSession } from '../../domain/entities/user-session.entity.js';
import {
  AuthenticateUserCommand,
  AuthTokensDto,
} from '../dto/auth.dto.js';
import {
  InvalidCredentialsException,
  AccountLockedException,
} from '../../domain/exceptions/identity.exceptions.js';

export class AuthenticateUserUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly sessionRepository: UserSessionRepository,
    private readonly auditLogRepository: AuthAuditLogRepository,
    private readonly tokenService: TokenService,
  ) {}

  async execute(command: AuthenticateUserCommand): Promise<AuthTokensDto> {
    let emailVo: Email;
    try {
      emailVo = new Email(command.email);
    } catch {
      // Prevent email format leaks
      throw new InvalidCredentialsException();
    }

    const user = await this.userRepository.findByEmail(emailVo);
    if (!user) {
      await this.auditLogRepository.record({
        email: emailVo.value,
        eventType: 'LOGIN_FAILURE',
        ipAddress: command.ipAddress,
        userAgent: command.userAgent,
        correlationId: command.correlationId,
        metadata: { reason: 'USER_NOT_FOUND' },
      });
      throw new InvalidCredentialsException();
    }

    // Check account status & lockout
    try {
      user.assertCanAuthenticate();
    } catch (err) {
      if (err instanceof AccountLockedException) {
        await this.auditLogRepository.record({
          userId: user.id,
          email: user.email.value,
          eventType: 'ACCOUNT_LOCKED',
          ipAddress: command.ipAddress,
          userAgent: command.userAgent,
          correlationId: command.correlationId,
          metadata: { lockedUntil: user.lockedUntil?.toISOString() },
        });
      }
      throw err;
    }

    // Verify password using Argon2id constant-time verification
    const isPasswordValid = await user.passwordHash.verify(command.password);
    if (!isPasswordValid) {
      const isLocked = user.recordFailedLogin();
      await this.userRepository.save(user);

      if (isLocked) {
        await this.auditLogRepository.record({
          userId: user.id,
          email: user.email.value,
          eventType: 'ACCOUNT_LOCKED',
          ipAddress: command.ipAddress,
          userAgent: command.userAgent,
          correlationId: command.correlationId,
          metadata: { attempts: user.failedLoginAttempts },
        });
        throw new AccountLockedException(user.lockedUntil!);
      }

      await this.auditLogRepository.record({
        userId: user.id,
        email: user.email.value,
        eventType: 'LOGIN_FAILURE',
        ipAddress: command.ipAddress,
        userAgent: command.userAgent,
        correlationId: command.correlationId,
        metadata: { attempts: user.failedLoginAttempts },
      });
      throw new InvalidCredentialsException();
    }

    // Successful login: reset failed counters
    user.recordSuccessfulLogin();
    await this.userRepository.save(user);

    // Create session family & persistent session
    const sessionId = crypto.randomUUID();
    const sessionFamilyId = crypto.randomUUID();
    const refreshTokenData = this.tokenService.createRefreshToken();

    // 7 days refresh TTL
    const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const session = new UserSession({
      id: sessionId,
      userId: user.id,
      refreshTokenHash: refreshTokenData.hash,
      sessionFamilyId,
      deviceFingerprint: command.deviceFingerprint,
      ipAddress: command.ipAddress,
      userAgent: command.userAgent,
      expiresAt: refreshExpiresAt,
    });

    await this.sessionRepository.save(session);

    // Build principal and access token (15 minutes)
    const principal = new AuthenticatedPrincipal({
      id: user.id,
      email: user.email.value,
      roles: ['ROLE_CUSTOMER'],
      kycStatus: user.kycStatus,
      sessionId: session.id,
    });

    const accessToken = await this.tokenService.createAccessToken(principal, 900);

    await this.auditLogRepository.record({
      userId: user.id,
      email: user.email.value,
      eventType: 'LOGIN_SUCCESS',
      ipAddress: command.ipAddress,
      userAgent: command.userAgent,
      correlationId: command.correlationId,
      metadata: { sessionId: session.id, sessionFamilyId },
    });

    return {
      accessToken,
      refreshToken: refreshTokenData.token,
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
