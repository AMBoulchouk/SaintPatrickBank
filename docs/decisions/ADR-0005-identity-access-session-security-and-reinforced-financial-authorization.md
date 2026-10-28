# ADR-0005: Identity & Access Bounded Context, Cryptographic Sessions, and Reinforced Financial Authorization

**Status:** Accepted (Validated via PostgreSQL 18 Testcontainers Suite)  
**Deciders:** Senior Software Architect, Lead Security Engineer, Core Platform Team  
**Date:** October 28, 2026  
**Context & Scope:** Bounded Context `@spbk/identity`, Security Guards (`@spbk/api`), Reinforced Authorization in `@spbk/accounts`, and RFC 9457 Standard Correction

---

## Context and Problem Statement

In the previous development phase, `FinancialAuthGuard` operated using simulated trusted headers (`X-User-Id`, `X-User-Roles`, `X-Kyc-Status`). While appropriate for isolated architectural prototyping, in a production-grade financial platform operating under BCRA and UIF regulations, arbitrary client-injected HTTP headers represent an intolerable vulnerability.

Furthermore, three fundamental security and architectural challenges required resolution:
1. **Cryptographic Identity Verification:** No client or proxy may declare customer identity or permissions through unverified headers. Authentication must establish an unbroken cryptographic chain of trust.
2. **Stale Claims & Concurrency Bugs (TOCTOU):** Storing financial permissions or KYC levels purely inside access tokens risks allowing unauthorized operations if a customer is suspended or blocked *after* token issuance. Financial operations require fresh, row-locked database verification to eliminate Time-of-Check to Time-of-Use race conditions.
3. **Registration vs. Financial Enablement:** Registering an email or credentials does not entitle a user to operate funds. Identity creation must be strictly separated from Compliance evaluation and Ledger account provisioning.

---

## Decision Drivers

* **Zero Plaintext Secrets:** No plaintext passwords, refresh tokens, or API secrets may be stored in PostgreSQL or logged.
* **Argon2id Memory-Hard Hashing:** Password hashing must adhere to OWASP guidelines using Argon2id with recommended parameters ($m=19456\text{ KiB}, t=2, p=1$).
* **Cryptographic Token Model:** Short-lived access tokens (15m) signed with HMAC-SHA256 (HS256) verifying `sub`, `iss`, `aud`, `exp`, `nbf`, and `jti`.
* **Refresh Token Rotation & Reuse Detection:** Single-use refresh tokens stored as SHA-256 hashes. Presenting an already-used refresh token indicates a token compromise and triggers immediate revocation of the entire token family.
* **Anti-Spoofing Enforcement:** Any request containing arbitrary identity headers (`X-User-Id`, `X-User-Roles`, `X-Kyc-Status`) is explicitly rejected.
* **RFC 9457 Compliance:** Error payloads must conform to RFC 9457 ("Problem Details for HTTP APIs", June 2023, obsoleting RFC 7807), maintaining strict information sanitization.
* **COELSA Modulo 10 Algorithm:** Local CVU format and check digits must strictly adhere to the official COELSA weighted Modulo 10 standard.

---

## Decision Outcome

### 1. Bounded Context Architecture: `@spbk/identity`

The Identity bounded context is established with strict Domain-Driven Design separation:

```
[ Domain Layer ]
  Entities: User, UserSession
  Value Objects: Email, PasswordHash (Argon2id), AuthenticatedPrincipal
  Ports: UserRepository, UserSessionRepository, AuthAuditLogRepository, TokenService, CustomerStatusPort
  Exceptions: InvalidCredentialsException, AccountLockedException, TokenReuseDetectedException, ...

[ Application Layer ]
  Use Cases: RegisterUserUseCase, AuthenticateUserUseCase, RefreshTokenUseCase, RevokeSessionUseCase
  DTOs: RegisterUserCommand, AuthenticateUserCommand, RefreshTokenCommand, AuthTokensDto

[ Infrastructure Layer ]
  Crypto: Argon2PasswordHasher, JwtTokenService (HMAC-SHA256 with key rotation support)
  Repositories: PgUserRepository, PgUserSessionRepository, PgAuthAuditLogRepository
  Adapters: PgCustomerStatusAdapter (Fresh verification with SELECT ... FOR UPDATE)
```

### 2. Entity-Relationship Model (PostgreSQL 18 `identity` Schema)

```
                    +------------------------------------+
                    |          identity.users            |
                    +------------------------------------+
                    | id (UUID, PK)                      |
                    | email (VARCHAR(255), UNIQUE)       |
                    | password_hash (VARCHAR(255))       |
                    | first_name (VARCHAR(100))          |
                    | last_name (VARCHAR(100))           |
                    | tax_id (VARCHAR(20), UNIQUE CUIT)  |
                    | status (user_status ENUM)          |
                    | kyc_status (kyc_status ENUM)       |
                    | email_verified_at (TIMESTAMPTZ)    |
                    | failed_login_attempts (INT)        |
                    | locked_until (TIMESTAMPTZ)         |
                    | is_mfa_enabled (BOOLEAN)           |
                    | mfa_secret (VARCHAR(255))          |
                    | password_changed_at (TIMESTAMPTZ)  |
                    | created_at, updated_at             |
                    +-----------------+------------------+
                                      | 1
                                      |
                     +----------------+----------------+
                     | 1..*                            | 0..*
+--------------------+-------------+   +---------------+------------------+
|      identity.user_sessions      |   |    identity.auth_audit_logs      |
+----------------------------------+   +----------------------------------+
| id (UUID, PK)                    |   | id (UUID, PK)                    |
| user_id (UUID, FK -> users)      |   | user_id (UUID, FK -> users)      |
| refresh_token_hash (CHAR(64))    |   | email (VARCHAR(255))             |
| session_family_id (UUID)         |   | event_type (auth_event ENUM)     |
| is_used (BOOLEAN)                |   | ip_address (VARCHAR(45))         |
| device_fingerprint (VARCHAR(255))|   | user_agent (TEXT)                |
| ip_address (VARCHAR(45))         |   | correlation_id (VARCHAR(64))     |
| user_agent (TEXT)                |   | metadata (JSONB)                 |
| expires_at (TIMESTAMPTZ)         |   | created_at (TIMESTAMPTZ)         |
| revoked_at (TIMESTAMPTZ)         |   +----------------------------------+
| created_at, updated_at           |
+----------------------------------+
```

### 3. Token Strategy & Cryptographic Key Management

1. **Access Tokens:**
   - **Lifespan:** 15 minutes (900 seconds).
   - **Algorithm:** `HS256` (HMAC with SHA-256).
   - **Secret Key:** Vault-managed symmetric secret (minimum 256 bits).
   - **Key Rotation:** `JwtTokenService` supports an array of `previousSecretKeys`. Active tokens are signed with the current key, but incoming tokens are accepted if verified against previous active keys, allowing zero-downtime rotation.
   - **Claims:**
     - `sub`: User UUID.
     - `iss`: `saintpatrickbk-auth`.
     - `aud`: `saintpatrickbk-api`.
     - `exp`: Expiration epoch timestamp.
     - `nbf`: Not-before timestamp.
     - `jti`: Unique UUID to defend against immediate replay.
     - `roles`: Assigned roles (`['ROLE_CUSTOMER']`).
2. **Refresh Tokens:**
   - **Lifespan:** 7 days.
   - **Entropy:** 256-bit cryptographically secure pseudorandom token (`crypto.randomBytes(32)`).
   - **Storage:** Only the SHA-256 hash (`CHAR(64)`) is stored in `identity.user_sessions`. The raw token is sent only once to the client.
   - **Rotation:** Every refresh invalidates the used refresh token (`is_used = TRUE`) and issues a new pair linked to the same `session_family_id`.
   - **Reuse Detection:** If an incoming refresh token resolves to a session where `is_used = TRUE`, the system detects an in-flight theft attack. It immediately executes `revokeAllForFamily(session_family_id)`, terminating all active sessions for that token family and logging `TOKEN_REUSE_DETECTED`.

### 4. MFA & Phishing-Resistant Authentication (WebAuthn / Passkeys)

* **TOTP Support (RFC 6238):** Time-based one-time passwords for mobile authenticator apps.
* **WebAuthn / FIDO2 Passkeys Evaluation:**
  - Evaluated as the gold standard for phishing resistance, binding credentials cryptographically to the platform origin (`https://api.saintpatrickbk.com`).
  - **No Mandatory Biometrics:** Passkeys do not require biometrics; hardware security keys (YubiKey), OS PINs, and hybrid roaming authenticators are fully supported, ensuring accessibility for all customer segments.
* **Step-Up Authentication:** High-value transfers exceeding the single transfer threshold trigger a mandatory step-up challenge (`MfaRequiredException`).

### 5. Financial Authorization & Anti-Spoofing Guard

1. **`FinancialAuthGuard` Refactoring:**
   - Detects and rejects any attempt to inject `X-User-Id`, `X-User-Roles`, or `X-Kyc-Status`.
   - Enforces `Authorization: Bearer <token>`.
   - Cryptographically verifies signature, expiration, issuer, and audience using `JwtTokenService`.
   - Injects the immutable `AuthenticatedPrincipal` into `request.user`.
2. **Fresh KYC Verification & TOCTOU Defense:**
   - In `ExecuteInternalTransferUseCase`, financial operations do not rely solely on the token's KYC claim.
   - The use case invokes `CustomerCompliancePort.getLiveCustomerStatus(customerId)`, querying the database with `SELECT ... FOR UPDATE` row locks on the account and user rows.
   - If KYC was revoked or the account was blocked concurrently, the transfer is rejected immediately with `InsufficientKycLevelException` or `AccountNotActiveException`.

### 6. Onboarding Lifecycle: Identity ↔ Compliance ↔ Accounts

```
[ Client Registration ]
       |
       v
1. Create Identity (User: PENDING_VERIFICATION, KYC: PENDING)
       |
       v
2. Email Verification Token (User: ACTIVE, KYC: PENDING)
       |
       v
3. Customer Identification & Screening (CUIT/CUIL, PEP, Sanctions lists)
       |
       +---> [ Compliance Review ]
                   |
     +-------------+-------------+
     | Rejected                  | Approved
     v                           v
  KYC: REJECTED            KYC: VERIFIED
  (Transfers blocked)            |
                                 v
                 4. Coordinated Account Provisioning
                    - Transactionally create ledger account: 2101-CUST-xxx
                    - Transactionally create payment account: accounts.payment_accounts
                    - Operational status: ACTIVE
```

**Key Invariant:** A payment account cannot become active without its corresponding liability account (`2101-CUST-xxx`) confirmed in `@spbk/ledger`.

### 7. CVU & Alias Architecture (COELSA Weighted Modulo 10)

1. **Local Mathematical Validation:**
   - Implemented in `CVU` Value Object.
   - Block 1 (8 digits): Digits 1-7 weighted by `[7, 1, 3, 9, 7, 1, 3]`. Check digit $D_1 = (10 - (\sum \pmod{10})) \pmod{10}$.
   - Block 2 (14 digits): Digits 9-21 weighted by `[3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]`. Check digit $D_2 = (10 - (\sum \pmod{10})) \pmod{10}$.
2. **Three-Tier CVU Distinction:**
   - **Local Validation:** Verifies formatting and Modulo 10 mathematical integrity.
   - **Synthetic Test Generation:** `CVU.createForTesting()` generates valid check digits for unit and integration testing. Strictly segregated from external networks.
   - **Operational Assignment:** Defined in `ICvuAssignmentProvider`. Requires official BCRA PSP registration number, bilateral COELSA clearing interconnect, and real-time synchronization with the Argentine National CVU Directory.

### 8. RFC 9457 HTTP Problem Details Correction

- `ProblemDetailsExceptionFilter` and the OpenAPI 3.1 contract are updated to reference **RFC 9457** (June 2023), which formally obsoleted RFC 7807.
- Normalized fields: `type`, `title`, `status`, `detail`, `code`, `instance`, `correlationId`, `timestamp`.
- Strict sanitization: PostgreSQL internal errors, query texts, and stack traces are suppressed from client responses and stored exclusively in application audit logs.

---

## Verification & Test Results

The architecture was validated against real PostgreSQL 18 via Testcontainers:
* **Registration & Argon2id:** `$argon2id$` memory-hard hashing verified.
* **Brute Force Lockout:** Account locked after 5 consecutive failed attempts.
* **Refresh Token Rotation & Reuse Detection:** Presentation of an already-used refresh token immediately revoked the entire session family.
* **Anti-Spoofing:** All attempts to inject `X-User-Id`, `X-User-Roles`, and `X-Kyc-Status` rejected with 401 Unauthorized.
* **Cryptographic Guard:** Expired, altered, or forged tokens rejected.
* **Live KYC & TOCTOU:** Concurrency row locking verified inside transactions.
