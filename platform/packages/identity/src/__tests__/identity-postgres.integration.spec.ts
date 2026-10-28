import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigrations } from '@spbk/ledger';

import {
  PgUserRepository,
  PgUserSessionRepository,
  PgAuthAuditLogRepository,
  PgCustomerStatusAdapter,
  JwtTokenService,
  RegisterUserUseCase,
  AuthenticateUserUseCase,
  RefreshTokenUseCase,
  RevokeSessionUseCase,
  Email,
  EmailAlreadyRegisteredException,
  TaxIdAlreadyRegisteredException,
  InvalidCredentialsException,
  AccountLockedException,
  TokenReuseDetectedException,
  SessionRevokedException,
} from '../index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('Identity & Access Management - PostgreSQL 18 Integration Tests', () => {
  let container: StartedPostgreSqlContainer;
  let adminPool: Pool;
  let appPool: Pool;

  let userRepo: PgUserRepository;
  let sessionRepo: PgUserSessionRepository;
  let auditLogRepo: PgAuthAuditLogRepository;
  let customerStatusAdapter: PgCustomerStatusAdapter;
  let tokenService: JwtTokenService;

  let registerUseCase: RegisterUserUseCase;
  let authUseCase: AuthenticateUserUseCase;
  let refreshUseCase: RefreshTokenUseCase;
  let revokeUseCase: RevokeSessionUseCase;

  const JWT_SECRET = 'financial_vault_production_grade_secret_key_256_bits_min!';

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18')
      .withDatabase('saintpatrickbk_identity_test')
      .withUsername('postgres')
      .withPassword('postgres')
      .start();

    adminPool = new Pool({
      connectionString: container.getConnectionUri(),
    });

    // Run sequential migrations 001 through 007
    const migrationsDir = path.resolve(__dirname, '../../../ledger/migrations');
    await runMigrations(adminPool, migrationsDir);

    // App pool connects as the runtime application role (spbk_app)
    appPool = new Pool({
      host: container.getHost(),
      port: container.getPort(),
      database: 'saintpatrickbk_identity_test',
      user: 'spbk_app',
      password: 'spbk_app_dev_secret',
    });

    userRepo = new PgUserRepository(appPool);
    sessionRepo = new PgUserSessionRepository(appPool);
    auditLogRepo = new PgAuthAuditLogRepository(appPool);
    customerStatusAdapter = new PgCustomerStatusAdapter(appPool);

    tokenService = new JwtTokenService({
      secretKey: JWT_SECRET,
      issuer: 'saintpatrickbk-auth',
      audience: 'saintpatrickbk-api',
      defaultAccessTtlSeconds: 900,
    });

    registerUseCase = new RegisterUserUseCase(userRepo, auditLogRepo);
    authUseCase = new AuthenticateUserUseCase(userRepo, sessionRepo, auditLogRepo, tokenService);
    refreshUseCase = new RefreshTokenUseCase(userRepo, sessionRepo, auditLogRepo, tokenService);
    revokeUseCase = new RevokeSessionUseCase(sessionRepo, auditLogRepo);
  }, 90000);

  afterAll(async () => {
    if (appPool) await appPool.end();
    if (adminPool) await adminPool.end();
    if (container) await container.stop();
  }, 60000);

  // ---------------------------------------------------------------------------
  // 1. User Registration & Argon2id Hashing
  // ---------------------------------------------------------------------------
  describe('User Registration & Argon2id Storage', () => {
    it('should register a new customer with Argon2id password hash and PENDING KYC', async () => {
      const user = await registerUseCase.execute({
        email: 'martin.palermo@saintpatrickbk.com',
        password: 'SecureP@ssword2026!',
        firstName: 'Martín',
        lastName: 'Palermo',
        taxId: '20-12345678-9',
        ipAddress: '190.220.10.5',
        userAgent: 'Mozilla/5.0 SaintPatrickBK Mobile',
        correlationId: 'reg-corr-001',
      });

      expect(user.id).toBeDefined();
      expect(user.email).toBe('martin.palermo@saintpatrickbk.com');
      expect(user.status).toBe('PENDING_VERIFICATION');
      expect(user.kycStatus).toBe('PENDING');

      // Verify raw database record
      const rawUser = await userRepo.findById(user.id);
      expect(rawUser).not.toBeNull();
      // Must be standard Argon2id memory-hard format
      expect(rawUser?.passwordHash.value).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
      // Plaintext password MUST NOT be stored anywhere
      expect(rawUser?.passwordHash.value).not.toContain('SecureP@ssword2026!');
    });

    it('should reject registration when email is already registered', async () => {
      await expect(
        registerUseCase.execute({
          email: 'martin.palermo@saintpatrickbk.com', // Duplicate
          password: 'OtherPassword123!',
          firstName: 'Another',
          lastName: 'Person',
          taxId: '20-99999999-9',
          ipAddress: '190.220.10.5',
        }),
      ).rejects.toThrow(EmailAlreadyRegisteredException);
    });

    it('should reject registration when tax ID (CUIT) is already registered', async () => {
      await expect(
        registerUseCase.execute({
          email: 'unique.email@saintpatrickbk.com',
          password: 'OtherPassword123!',
          firstName: 'Another',
          lastName: 'Person',
          taxId: '20-12345678-9', // Duplicate tax ID
          ipAddress: '190.220.10.5',
        }),
      ).rejects.toThrow(TaxIdAlreadyRegisteredException);
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Authentication & Brute-Force Lockout
  // ---------------------------------------------------------------------------
  describe('Authentication, Argon2id Verification & Brute-Force Defense', () => {
    it('should authenticate successfully with valid credentials and return token pair', async () => {
      const tokens = await authUseCase.execute({
        email: 'martin.palermo@saintpatrickbk.com',
        password: 'SecureP@ssword2026!',
        ipAddress: '190.220.10.5',
        userAgent: 'SaintPatrickBK-App/1.0',
        deviceFingerprint: 'device-fingerprint-alpha',
        correlationId: 'auth-corr-001',
      });

      expect(tokens.accessToken).toBeDefined();
      expect(tokens.refreshToken).toBeDefined();
      expect(tokens.expiresInSeconds).toBe(900);
      expect(tokens.tokenType).toBe('Bearer');

      // Verify access token cryptographically
      const principal = await tokenService.verifyAccessToken(tokens.accessToken);
      expect(principal.email).toBe('martin.palermo@saintpatrickbk.com');
      expect(principal.roles).toContain('ROLE_CUSTOMER');

      // Verify session in database
      const hashedRefreshToken = tokenService.hashRefreshToken(tokens.refreshToken);
      const session = await sessionRepo.findByRefreshTokenHash(hashedRefreshToken);
      expect(session).not.toBeNull();
      expect(session?.isUsed).toBe(false);
      expect(session?.deviceFingerprint).toBe('device-fingerprint-alpha');
    });

    it('should reject invalid password and increment failed attempts', async () => {
      await expect(
        authUseCase.execute({
          email: 'martin.palermo@saintpatrickbk.com',
          password: 'WrongPassword!',
          ipAddress: '190.220.10.5',
        }),
      ).rejects.toThrow(InvalidCredentialsException);

      const user = await userRepo.findByEmail(new Email('martin.palermo@saintpatrickbk.com'));
      expect(user?.failedLoginAttempts).toBe(1);
    });

    it('should lock user account after 5 consecutive failed attempts (Brute Force Lockout)', async () => {
      // 4 more failed attempts (total = 5)
      for (let i = 0; i < 3; i++) {
        await expect(
          authUseCase.execute({
            email: 'martin.palermo@saintpatrickbk.com',
            password: 'WrongPassword!',
            ipAddress: '190.220.10.5',
          }),
        ).rejects.toThrow(InvalidCredentialsException);
      }

      // 5th attempt must trigger AccountLockedException
      await expect(
        authUseCase.execute({
          email: 'martin.palermo@saintpatrickbk.com',
          password: 'WrongPassword!',
          ipAddress: '190.220.10.5',
        }),
      ).rejects.toThrow(AccountLockedException);

      const lockedUser = await userRepo.findByEmail(new Email('martin.palermo@saintpatrickbk.com'));
      expect(lockedUser?.failedLoginAttempts).toBe(5);
      expect(lockedUser?.lockedUntil).not.toBeNull();
      expect(lockedUser?.isLocked()).toBe(true);

      // Even correct password must be rejected while locked
      await expect(
        authUseCase.execute({
          email: 'martin.palermo@saintpatrickbk.com',
          password: 'SecureP@ssword2026!',
          ipAddress: '190.220.10.5',
        }),
      ).rejects.toThrow(AccountLockedException);
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Refresh Tokens, Rotation & Token Family Reuse Detection
  // ---------------------------------------------------------------------------
  describe('Refresh Token Rotation & Security Breach Reuse Detection', () => {
    let activeRefreshToken: string;
    let registeredUserId: string;

    beforeAll(async () => {
      // Create fresh active user
      const user = await registerUseCase.execute({
        email: 'juan.riquelme@saintpatrickbk.com',
        password: 'Password10Riquelme!',
        firstName: 'Juan Román',
        lastName: 'Riquelme',
        taxId: '20-10101010-0',
        ipAddress: '190.220.10.10',
      });
      registeredUserId = user.id;

      // Unlock and activate user directly
      await adminPool.query(
        "UPDATE identity.users SET status = 'ACTIVE', failed_login_attempts = 0, locked_until = NULL WHERE id = $1",
        [registeredUserId],
      );

      const login = await authUseCase.execute({
        email: 'juan.riquelme@saintpatrickbk.com',
        password: 'Password10Riquelme!',
        ipAddress: '190.220.10.10',
      });
      activeRefreshToken = login.refreshToken;
    });

    it('should rotate refresh token and issue new token pair', async () => {
      const refreshed = await refreshUseCase.execute({
        refreshToken: activeRefreshToken,
        ipAddress: '190.220.10.10',
        correlationId: 'ref-corr-001',
      });

      expect(refreshed.accessToken).toBeDefined();
      expect(refreshed.refreshToken).toBeDefined();
      expect(refreshed.refreshToken).not.toBe(activeRefreshToken);

      // Verify old refresh token is marked as USED
      const oldHash = tokenService.hashRefreshToken(activeRefreshToken);
      const oldSession = await sessionRepo.findByRefreshTokenHash(oldHash);
      expect(oldSession?.isUsed).toBe(true);

      // Save new refresh token for next test
      const nextToken = refreshed.refreshToken;

      // 4. REUSE DETECTION ATTACK: Re-presenting the OLD refresh token MUST revoke family!
      await expect(
        refreshUseCase.execute({
          refreshToken: activeRefreshToken, // Already used token!
          ipAddress: '190.220.10.10',
          correlationId: 'attack-replay-001',
        }),
      ).rejects.toThrow(TokenReuseDetectedException);

      // Invariant: The new token must now ALSO be revoked because its family was revoked!
      await expect(
        refreshUseCase.execute({
          refreshToken: nextToken,
          ipAddress: '190.220.10.10',
        }),
      ).rejects.toThrow(SessionRevokedException);
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Session Revocation & Multi-Device Management
  // ---------------------------------------------------------------------------
  describe('Session Revocation & Multi-Device Support', () => {
    it('should manage multiple concurrent sessions and revoke all on demand', async () => {
      const user = await registerUseCase.execute({
        email: 'carlos.tevez@saintpatrickbk.com',
        password: 'Password32Tevez!',
        firstName: 'Carlos',
        lastName: 'Tevez',
        taxId: '20-32323232-2',
        ipAddress: '190.220.10.32',
      });

      await adminPool.query("UPDATE identity.users SET status = 'ACTIVE' WHERE id = $1", [user.id]);

      // Login from Device 1 (Mobile)
      const session1 = await authUseCase.execute({
        email: 'carlos.tevez@saintpatrickbk.com',
        password: 'Password32Tevez!',
        ipAddress: '190.220.10.32',
        deviceFingerprint: 'device-mobile-iphone15',
      });

      // Login from Device 2 (Laptop)
      const session2 = await authUseCase.execute({
        email: 'carlos.tevez@saintpatrickbk.com',
        password: 'Password32Tevez!',
        ipAddress: '190.220.10.32',
        deviceFingerprint: 'device-desktop-macbook',
      });

      // Both sessions must be active in DB
      const activeSessions = await sessionRepo.findActiveByUserId(user.id);
      expect(activeSessions).toHaveLength(2);

      // Revoke all sessions for user (e.g. password reset or device loss)
      await revokeUseCase.execute({
        userId: user.id,
        revokeAll: true,
        ipAddress: '190.220.10.32',
      });

      const remainingSessions = await sessionRepo.findActiveByUserId(user.id);
      expect(remainingSessions).toHaveLength(0);

      // Both refresh tokens must now be rejected
      await expect(
        refreshUseCase.execute({
          refreshToken: session1.refreshToken,
          ipAddress: '190.220.10.32',
        }),
      ).rejects.toThrow(SessionRevokedException);

      await expect(
        refreshUseCase.execute({
          refreshToken: session2.refreshToken,
          ipAddress: '190.220.10.32',
        }),
      ).rejects.toThrow(SessionRevokedException);
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Fresh Live KYC Checking & TOCTOU Defense
  // ---------------------------------------------------------------------------
  describe('Fresh Live KYC Check & Concurrency Defense (TOCTOU)', () => {
    it('should reflect live database KYC changes and support row locking', async () => {
      const user = await registerUseCase.execute({
        email: 'diego.maradona@saintpatrickbk.com',
        password: 'D10SForever1986!',
        firstName: 'Diego',
        lastName: 'Maradona',
        taxId: '20-10101986-0',
        ipAddress: '190.220.10.10',
      });

      // Initially KYC is PENDING -> cannot operate financially
      const initialStatus = await customerStatusAdapter.getLiveCustomerStatus(user.id);
      expect(initialStatus?.canOperateFinancially).toBe(false);
      expect(initialStatus?.kycStatus).toBe('PENDING');

      // Update to VERIFIED and ACTIVE
      await adminPool.query(
        "UPDATE identity.users SET status = 'ACTIVE', kyc_status = 'VERIFIED' WHERE id = $1",
        [user.id],
      );

      const verifiedStatus = await customerStatusAdapter.getLiveCustomerStatus(user.id);
      expect(verifiedStatus?.canOperateFinancially).toBe(true);
      expect(verifiedStatus?.kycStatus).toBe('VERIFIED');

      // Test transactional row locking (SELECT ... FOR UPDATE)
      const client = await appPool.connect();
      try {
        await client.query('BEGIN');
        const lockedStatus = await customerStatusAdapter.getLiveCustomerStatus(user.id, {
          lockRow: true,
          client,
        });
        expect(lockedStatus?.canOperateFinancially).toBe(true);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    });
  });

  // ---------------------------------------------------------------------------
  // 6. Auth Audit Logs
  // ---------------------------------------------------------------------------
  describe('Append-Only Security Audit Trail', () => {
    it('should have recorded all critical authentication events in identity.auth_audit_logs', async () => {
      const logs = await adminPool.query<{ event_type: string }>(
        'SELECT event_type FROM identity.auth_audit_logs ORDER BY created_at ASC',
      );

      const eventTypes = logs.rows.map((r) => r.event_type);
      expect(eventTypes).toContain('LOGIN_SUCCESS');
      expect(eventTypes).toContain('LOGIN_FAILURE');
      expect(eventTypes).toContain('ACCOUNT_LOCKED');
      expect(eventTypes).toContain('TOKEN_REFRESH');
      expect(eventTypes).toContain('TOKEN_REUSE_DETECTED');
      expect(eventTypes).toContain('SESSION_REVOKED');
    });
  });
});
