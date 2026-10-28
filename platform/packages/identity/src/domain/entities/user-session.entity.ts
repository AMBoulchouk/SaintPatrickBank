export interface UserSessionProps {
  readonly id: string;
  readonly userId: string;
  readonly refreshTokenHash: string;
  readonly sessionFamilyId: string;
  readonly isUsed?: boolean | undefined;
  readonly deviceFingerprint?: string | null | undefined;
  readonly ipAddress: string;
  readonly userAgent?: string | null | undefined;
  readonly expiresAt: Date;
  readonly revokedAt?: Date | null | undefined;
  readonly createdAt?: Date | undefined;
  readonly updatedAt?: Date | undefined;
}

export class UserSession {
  private readonly _id: string;
  private readonly _userId: string;
  private readonly _refreshTokenHash: string;
  private readonly _sessionFamilyId: string;
  private _isUsed: boolean;
  private readonly _deviceFingerprint: string | null;
  private readonly _ipAddress: string;
  private readonly _userAgent: string | null;
  private readonly _expiresAt: Date;
  private _revokedAt: Date | null;
  private readonly _createdAt: Date;
  private _updatedAt: Date;

  constructor(props: UserSessionProps) {
    this._id = props.id;
    this._userId = props.userId;
    this._refreshTokenHash = props.refreshTokenHash;
    this._sessionFamilyId = props.sessionFamilyId;
    this._isUsed = props.isUsed ?? false;
    this._deviceFingerprint = props.deviceFingerprint ?? null;
    this._ipAddress = props.ipAddress;
    this._userAgent = props.userAgent ?? null;
    this._expiresAt = props.expiresAt;
    this._revokedAt = props.revokedAt ?? null;
    this._createdAt = props.createdAt ?? new Date();
    this._updatedAt = props.updatedAt ?? new Date();
  }

  get id(): string { return this._id; }
  get userId(): string { return this._userId; }
  get refreshTokenHash(): string { return this._refreshTokenHash; }
  get sessionFamilyId(): string { return this._sessionFamilyId; }
  get isUsed(): boolean { return this._isUsed; }
  get deviceFingerprint(): string | null { return this._deviceFingerprint; }
  get ipAddress(): string { return this._ipAddress; }
  get userAgent(): string | null { return this._userAgent; }
  get expiresAt(): Date { return this._expiresAt; }
  get revokedAt(): Date | null { return this._revokedAt; }
  get createdAt(): Date { return this._createdAt; }
  get updatedAt(): Date { return this._updatedAt; }

  isExpired(now = new Date()): boolean {
    return this._expiresAt.getTime() <= now.getTime();
  }

  isRevoked(): boolean {
    return this._revokedAt !== null;
  }

  isUsable(now = new Date()): boolean {
    return !this._isUsed && !this.isRevoked() && !this.isExpired(now);
  }

  markUsed(now = new Date()): void {
    this._isUsed = true;
    this._updatedAt = now;
  }

  revoke(now = new Date()): void {
    this._revokedAt = now;
    this._updatedAt = now;
  }
}
