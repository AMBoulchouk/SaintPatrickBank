import * as crypto from 'node:crypto';
import { UserRepository } from '../../domain/ports/user.repository.interface.js';
import { AuthAuditLogRepository } from '../../domain/ports/auth-audit-log.repository.interface.js';
import { Email } from '../../domain/value-objects/email.vo.js';
import { PasswordHash } from '../../domain/value-objects/password-hash.vo.js';
import { User } from '../../domain/entities/user.entity.js';
import {
  RegisterUserCommand,
  UserProfileDto,
} from '../dto/auth.dto.js';
import {
  EmailAlreadyRegisteredException,
  TaxIdAlreadyRegisteredException,
} from '../../domain/exceptions/identity.exceptions.js';

export class RegisterUserUseCase {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly auditLogRepository: AuthAuditLogRepository,
  ) {}

  async execute(command: RegisterUserCommand): Promise<UserProfileDto> {
    const email = new Email(command.email);
    const sanitizedTaxId = command.taxId.trim();

    // 1. Check uniqueness of email
    const existingEmail = await this.userRepository.findByEmail(email);
    if (existingEmail) {
      throw new EmailAlreadyRegisteredException(email.value);
    }

    // 2. Check uniqueness of taxId (CUIT/CUIL)
    const existingTaxId = await this.userRepository.findByTaxId(sanitizedTaxId);
    if (existingTaxId) {
      throw new TaxIdAlreadyRegisteredException(sanitizedTaxId);
    }

    // 3. Hash password using Argon2id
    const passwordHash = await PasswordHash.create(command.password);

    // 4. Create new user entity with PENDING_VERIFICATION and PENDING KYC
    const userId = crypto.randomUUID();
    const user = new User({
      id: userId,
      email,
      passwordHash,
      firstName: command.firstName,
      lastName: command.lastName,
      taxId: sanitizedTaxId,
      status: 'PENDING_VERIFICATION',
      kycStatus: 'PENDING',
    });

    await this.userRepository.save(user);

    // 5. Audit record
    await this.auditLogRepository.record({
      userId: user.id,
      email: user.email.value,
      eventType: 'LOGIN_SUCCESS',
      ipAddress: command.ipAddress,
      userAgent: command.userAgent,
      correlationId: command.correlationId,
      metadata: { action: 'USER_REGISTERED', status: user.status },
    });

    return {
      id: user.id,
      email: user.email.value,
      firstName: user.firstName,
      lastName: user.lastName,
      taxId: user.taxId,
      status: user.status,
      kycStatus: user.kycStatus,
      isMfaEnabled: user.isMfaEnabled,
      createdAt: user.createdAt.toISOString(),
    };
  }
}
