-- =============================================================================
-- Migration 006: Create Accounts Schema and Payment Accounts Table
-- Authority: SaintPatrickBK Accounts Bounded Context (@spbk/accounts)
-- Owner: spbk_ledger_owner (Non-Superuser)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS accounts;

-- -----------------------------------------------------------------------------
-- 1. Account Status Enum
-- -----------------------------------------------------------------------------
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid WHERE t.typname = 'account_status' AND n.nspname = 'accounts') THEN
        CREATE TYPE accounts.account_status AS ENUM (
            'PENDING_KYC',
            'ACTIVE',
            'SUSPENDED',
            'BLOCKED',
            'CLOSED'
        );
    END IF;
END $$;

-- -----------------------------------------------------------------------------
-- 2. Payment Accounts Table (Operational Customer Account)
-- Links customer identity to their underlying ledger liability account
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts.payment_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL,
    account_number VARCHAR(64) NOT NULL UNIQUE,
    cvu CHAR(22) NOT NULL UNIQUE,
    alias VARCHAR(64) NOT NULL UNIQUE,
    currency CHAR(3) NOT NULL DEFAULT 'ARS',
    status accounts.account_status NOT NULL DEFAULT 'ACTIVE',
    daily_transfer_limit_cents BIGINT NOT NULL DEFAULT 500000000 CHECK (daily_transfer_limit_cents > 0),
    single_transfer_limit_cents BIGINT NOT NULL DEFAULT 200000000 CHECK (single_transfer_limit_cents > 0),
    ledger_account_id UUID NOT NULL REFERENCES ledger.ledger_accounts(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_accounts_customer 
ON accounts.payment_accounts(customer_id);

CREATE INDEX IF NOT EXISTS idx_payment_accounts_cvu 
ON accounts.payment_accounts(cvu);

CREATE INDEX IF NOT EXISTS idx_payment_accounts_alias 
ON accounts.payment_accounts(alias);

CREATE INDEX IF NOT EXISTS idx_payment_accounts_ledger_id 
ON accounts.payment_accounts(ledger_account_id);

-- -----------------------------------------------------------------------------
-- 3. Grants for Application Role (spbk_app)
-- Least privilege: SELECT, INSERT, UPDATE on payment_accounts (DELETE strictly forbidden)
-- -----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA accounts TO spbk_app;
GRANT SELECT, INSERT, UPDATE ON TABLE accounts.payment_accounts TO spbk_app;
REVOKE ALL ON accounts.payment_accounts FROM PUBLIC;
