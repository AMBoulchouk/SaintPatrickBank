import { User } from '../entities/user.entity.js';
import { Email } from '../value-objects/email.vo.js';

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  findByTaxId(taxId: string): Promise<User | null>;
  save(user: User): Promise<void>;
  /**
   * Loads a user by ID with row-level locking (SELECT ... FOR UPDATE) to defend against TOCTOU race conditions.
   */
  findByIdWithLock(id: string, client?: unknown): Promise<User | null>;
}
