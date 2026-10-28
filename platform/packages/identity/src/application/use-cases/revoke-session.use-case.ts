import { UserSessionRepository } from '../../domain/ports/user-session.repository.interface.js';
import { AuthAuditLogRepository } from '../../domain/ports/auth-audit-log.repository.interface.js';
import { RevokeSessionCommand } from '../dto/auth.dto.js';

export class RevokeSessionUseCase {
  constructor(
    private readonly sessionRepository: UserSessionRepository,
    private readonly auditLogRepository: AuthAuditLogRepository,
  ) {}

  async execute(command: RevokeSessionCommand): Promise<{ revokedCount: number }> {
    if (command.revokeAll && command.userId) {
      await this.sessionRepository.revokeAllForUser(command.userId);

      await this.auditLogRepository.record({
        userId: command.userId,
        eventType: 'SESSION_REVOKED',
        ipAddress: command.ipAddress,
        correlationId: command.correlationId,
        metadata: { action: 'REVOKE_ALL_SESSIONS_FOR_USER' },
      });

      return { revokedCount: -1 };
    }

    if (command.sessionId) {
      const session = await this.sessionRepository.findById(command.sessionId);
      if (session) {
        session.revoke();
        await this.sessionRepository.save(session);

        await this.auditLogRepository.record({
          userId: session.userId,
          eventType: 'LOGOUT',
          ipAddress: command.ipAddress,
          correlationId: command.correlationId,
          metadata: { sessionId: session.id },
        });

        return { revokedCount: 1 };
      }
    }

    return { revokedCount: 0 };
  }
}
