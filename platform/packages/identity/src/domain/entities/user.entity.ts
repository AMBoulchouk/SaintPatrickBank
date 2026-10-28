import { Email } from '../value-objects/email.vo.js';
import { PasswordHash } from '../value-objects/password-hash.vo.js';
import {
  KycVerificationStatus,
  UserLifecycleStatus,
} from '../value-objects/authenticated-principal.vo.js';
import {
  AccountLockedException,
  UserNotActiveException,
} from '../exceptions/identity.exceptions.js';

export interface UserProps {
  readonly id: string;
  readonly email: Email;
  readonly passwordHash: PasswordHash;
  readonly firstName: string;
  readonly lastName: string;
  readonly taxId: string;
  readonly status: UserLifecycleStatus;
  readonly kycStatus: KycVerificationStatus;
  readonly emailVerifiedAt?: Date | null | undefined;
  readonly failedLoginAttempts?: number | undefined;
  readonly lockedUntil?: Date | null | undefined;
  readonly isMfaEnabled?: boolean | undefined;
  readonly mfaSecret?: string | null | undefined;
  readonly passwordChangedAt?: Date | undefined;
  readonly createdAt?: Date | undefined;
  readonly updatedAt?: Date | undefined;
}

export class User {
  private readonly _id: string;
  private readonly _email: Email;
  private _passwordHash: PasswordHash;
  private _firstName: string;
  private _lastName: string;
  private readonly _taxId: string;
  private _status: UserLifecycleStatus;
  private _kycStatus: KycVerificationStatus;
  private _emailVerifiedAt: Date | null;
  private _failedLoginAttempts: number;
  private _lockedUntil: Date | null;
  private _isMfaEnabled: boolean;
  private _mfaSecret: string | null;
  private _passwordChangedAt: Date;
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  constructor(props: UserProps) {
    this._id = props.id;
    this._email = props.email;
    this._passwordHash = props.passwordHash;
    this._firstName = props.firstName.trim();
    this._lastName = props.lastName.trim();
    this._taxId = props.taxId.trim();
    this._status = props.status;
    this._kycStatus = props.kycStatus;
    this._emailVerifiedAt = props.emailVerifiedAt ?? null;
    this._failedLoginAttempts = props.failedLoginAttempts ?? 0;
    this._lockedUntil = props.lockedUntil ?? null;
    this._isMfaEnabled = props.isMfaEnabled ?? false;
    this._mfaSecret = props.mfaSecret ?? null;
    this._passwordChangedAt = props.passwordChangedAt ?? new Date();
    this._createdAt = props.createdAt ?? new Date();
    this._updatedAt = props.updatedAt ?? new Date();
  }

  get id(): string { return this._id; }
  get email(): Email { return this._email; }
  get passwordHash(): PasswordHash { return this._passwordHash; }
  get firstName(): string { return this._firstName; }
  get lastName(): string { return this._lastName; }
  get taxId(): string { return this._taxId; }
  get status(): UserLifecycleStatus { return this._status; }
  get kycStatus(): KycVerificationStatus { return this._kycStatus; }
  get emailVerifiedAt(): Date | null { return this._emailVerifiedAt; }
  get failedLoginAttempts(): number { return this._failedLoginAttempts; }
  get lockedUntil(): Date | null { return this._lockedUntil; }
  get isMfaEnabled(): boolean { return this._isMfaEnabled; }
  get mfaSecret(): string | null { return this._mfaSecret; }
  get passwordChangedAt(): Date { return this._passwordChangedAt; }
  get createdAt(): Date { return this._createdAt; }
  get updatedAt(): Date { return this._updatedAt; }

  isLocked(now = new Date()): boolean {
    if (!this._lockedUntil) return false;
    return this._lockedUntil.getTime() > now.getTime();
  }

  assertCanAuthenticate(now = new Date()): void {
    if (this._status === 'BLOCKED' || this._status === 'SUSPENDED') {
      throw new UserNotActiveException(this._id, this._status);
    }
    if (this.isLocked(now)) {
      throw new AccountLockedException(this._lockedUntil!);
    }
  }

  recordSuccessfulLogin(): void {
    this._failedLoginAttempts = 0;
    this._lockedUntil = null;
    this._updatedAt = new Date();
  }

  recordFailedLogin(maxAttempts = 5, lockoutMinutes = 15, now = new Date()): boolean {
    this._failedLoginAttempts += 1;
    this._updatedAt = now;

    if (this._failedLoginAttempts >= maxAttempts) {
      this._lockedUntil = new Date(now.getTime() + lockoutMinutes * 60 * 1000);
      return true; // Newly locked
    }
    return false;
  }

  verifyEmail(now = new Date()): void {
    this._emailVerifiedAt = now;
    if (this._status === 'PENDING_VERIFICATION') {
      this._status = 'ACTIVE';
    }
    this._updatedAt = now;
  }

  updateKycStatus(status: KycVerificationStatus, now = new Date()): void {
    this._kycStatus = status;
    this._updatedAt = now;
  }

  changePassword(newHash: PasswordHash, now = new Date()): void {
    this._passwordHash = newHash;
    this._passwordChangedAt = now;
    this._failedLoginAttempts = 0;
    this._lockedUntil = null;
    this._updatedAt = now;
  }

  blockUser(now = new Date()): void {
    this._status = 'BLOCKED';
    this._updatedAt = now;
  }

  suspendUser(now = new Date()): void {
    this._status = 'SUSPENDED';
    this._updatedAt = now;
  }
}
