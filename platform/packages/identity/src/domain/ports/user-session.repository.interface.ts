import { UserSession } from '../entities/user-session.entity.js';

export interface UserSessionRepository {
  findById(id: string): Promise<UserSession | null>;
  findByRefreshTokenHash(hash: string): Promise<UserSession | null>;
  findActiveByUserId(userId: string): Promise<readonly UserSession[]>;
  save(session: UserSession): Promise<void>;
  /**
   * Revokes all sessions belonging to the specified token family (used when token reuse is detected).
   */
  revokeAllForFamily(familyId: string): Promise<void>;
  /**
   * Revokes all active sessions for a given user (used on password change or account compromise).
   */
  revokeAllForUser(userId: string): Promise<void>;
}
