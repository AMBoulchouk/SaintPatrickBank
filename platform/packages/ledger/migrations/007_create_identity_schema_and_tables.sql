-- =============================================================================
-- Migration 007: Create Identity Schema, Users, Sessions and Audit Logs
-- Authority: SaintPatrickBK Identity & Access Bounded Context (@spbk/identity)
-- Owner: spbk_ledger_owner (Non-Superuser)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS identity;

-- -----------------------------------------------------------------------------
-- 1. Identity Enums
-- -----------------------------------------------------------------------------
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE t.typname = 'user_status' AND n.nspname = 'identity') THEN
        CREATE TYPE identity.user_status AS ENUM (
            'PENDING_VERIFICATION',
            'ACTIVE',
            'SUSPENDED',
            'BLOCKED'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE t.typname = 'kyc_status' AND n.nspname = 'identity') THEN
        CREATE TYPE identity.kyc_status AS ENUM (
            'PENDING',
            'VERIFIED',
            'REJECTED'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE t.typname = 'auth_audit_event_type' AND n.nspname = 'identity') THEN
        CREATE TYPE identity.auth_audit_event_type AS ENUM (
            'LOGIN_SUCCESS',
            'LOGIN_FAILURE',
            'TOKEN_REFRESH',
            'TOKEN_REUSE_DETECTED',
            'LOGOUT',
            'SESSION_REVOKED',
            'PASSWORD_RESET_REQUESTED',
            'PASSWORD_RESET_COMPLETED',
            'MFA_CHALLENGE_FAILED',
            'MFA_CHALLENGE_SUCCEEDED',
            'ACCOUNT_LOCKED'
        );
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Users Table
-- Core credentials, identity lifecycle, and KYC compliance state
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identity.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    tax_id VARCHAR(20) NOT NULL UNIQUE, -- CUIT/CUIL
    status identity.user_status NOT NULL DEFAULT 'PENDING_VERIFICATION',
    kyc_status identity.kyc_status NOT NULL DEFAULT 'PENDING',
    email_verified_at TIMESTAMPTZ NULL,
    failed_login_attempts INT NOT NULL DEFAULT 0 CHECK (failed_login_attempts >= 0),
    locked_until TIMESTAMPTZ NULL,
    is_mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    mfa_secret VARCHAR(255) NULL,
    password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_identity_users_email 
ON identity.users(email);

CREATE INDEX IF NOT EXISTS idx_identity_users_tax_id 
ON identity.users(tax_id);

CREATE INDEX IF NOT EXISTS idx_identity_users_status 
ON identity.users(status);

-- -----------------------------------------------------------------------------
-- 3. User Sessions Table
-- Persistent refresh tokens, token family rotation and reuse detection
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identity.user_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
    refresh_token_hash CHAR(64) NOT NULL UNIQUE, -- SHA-256 of the raw refresh token
    session_family_id UUID NOT NULL, -- Token family for rotation & reuse detection
    is_used BOOLEAN NOT NULL DEFAULT FALSE,
    device_fingerprint VARCHAR(255) NULL,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user 
ON identity.user_sessions(user_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_family 
ON identity.user_sessions(session_family_id);

CREATE INDEX IF NOT EXISTS idx_user_sessions_refresh_hash 
ON identity.user_sessions(refresh_token_hash);

-- -----------------------------------------------------------------------------
-- 4. Auth Audit Logs Table (Append-Only)
-- Full security traceability for authentication and session events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS identity.auth_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NULL REFERENCES identity.users(id) ON DELETE SET NULL,
    email VARCHAR(255) NULL,
    event_type identity.auth_audit_event_type NOT NULL,
    ip_address VARCHAR(45) NOT NULL,
    user_agent TEXT NULL,
    correlation_id VARCHAR(64) NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_audit_user_created 
ON identity.auth_audit_logs(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_auth_audit_event_created 
ON identity.auth_audit_logs(event_type, created_at DESC);

-- -----------------------------------------------------------------------------
-- 5. Grants for Application Role (spbk_app)
-- Principle of Least Privilege: NO DDL, controlled DML
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA identity TO spbk_app;
GRANT SELECT, INSERT, UPDATE ON TABLE identity.users TO spbk_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE identity.user_sessions TO spbk_app;
GRANT SELECT, INSERT ON TABLE identity.auth_audit_logs TO spbk_app;

-- Prohibit direct access from PUBLIC
REVOKE ALL ON SCHEMA identity FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA identity FROM PUBLIC;
