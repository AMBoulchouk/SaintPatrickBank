-- =============================================================================
-- Migration 002: Create Ledger Schema, Types, and Core Tables
-- Authority: SaintPatrickBK Core Financial Architecture
-- Owner: spbk_ledger_owner (Non-Superuser)
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS ledger AUTHORIZATION spbk_ledger_owner;

-- -----------------------------------------------------------------------------
-- 1. Types & Enums
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'ledger' AND t.typname = 'account_class') THEN
        CREATE TYPE ledger.account_class AS ENUM (
            'ASSET',      -- 1000: Commercial bank deposits, clearing transits
            'LIABILITY',  -- 2000: Customer stored value, in-flight reservations
            'EQUITY',     -- 3000: Regulatory capital, statutory reserves
            'REVENUE',    -- 4000: Processing fees, interchange income
            'EXPENSE'     -- 5000: Settlement fees, banking maintenance costs
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'ledger' AND t.typname = 'balance_direction') THEN
        CREATE TYPE ledger.balance_direction AS ENUM ('DEBIT', 'CREDIT');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'ledger' AND t.typname = 'account_status') THEN
        CREATE TYPE ledger.account_status AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'ledger' AND t.typname = 'operation_status') THEN
        CREATE TYPE ledger.operation_status AS ENUM (
            'INITIATED',
            'PENDING_FUNDS_RESERVATION',
            'PENDING_EXTERNAL_CONFIRMATION',
            'CONFIRMED',
            'REJECTED',
            'REVERSED'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'ledger' AND t.typname = 'reservation_status') THEN
        CREATE TYPE ledger.reservation_status AS ENUM ('ACTIVE', 'SETTLED', 'RELEASED', 'EXPIRED');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'ledger' AND t.typname = 'outbox_status') THEN
        CREATE TYPE ledger.outbox_status AS ENUM ('PENDING', 'DISPATCHED', 'FAILED');
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. Ledger Accounts (Chart of Accounts)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger.ledger_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(64) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    account_class ledger.account_class NOT NULL,
    normal_balance ledger.balance_direction NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'ARS',
    status ledger.account_status NOT NULL DEFAULT 'ACTIVE',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_currency_iso_format CHECK (currency ~ '^[A-Z]{3}$')
);

-- -----------------------------------------------------------------------------
-- 3. Materialized Account Balances (Concurrency Anchor)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger.account_balances (
    account_id UUID PRIMARY KEY REFERENCES ledger.ledger_accounts(id) ON DELETE RESTRICT,
    cleared_balance_cents BIGINT NOT NULL DEFAULT 0,
    reserved_balance_cents BIGINT NOT NULL DEFAULT 0,
    available_balance_cents BIGINT NOT NULL DEFAULT 0,
    currency CHAR(3) NOT NULL DEFAULT 'ARS',
    version BIGINT NOT NULL DEFAULT 1,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_reserved_non_negative CHECK (reserved_balance_cents >= 0),
    CONSTRAINT chk_balance_math_consistency CHECK (
        cleared_balance_cents = available_balance_cents + reserved_balance_cents
    )
);

-- -----------------------------------------------------------------------------
-- 4. Financial Operations (Business Process State Machine)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger.financial_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_reference_id VARCHAR(255) NOT NULL UNIQUE,
    request_hash CHAR(64) NOT NULL,
    operation_type VARCHAR(64) NOT NULL,
    status ledger.operation_status NOT NULL DEFAULT 'INITIATED',
    source_account_id UUID REFERENCES ledger.ledger_accounts(id) ON DELETE RESTRICT,
    destination_account_id UUID REFERENCES ledger.ledger_accounts(id) ON DELETE RESTRICT,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency CHAR(3) NOT NULL DEFAULT 'ARS',
    reversal_of_operation_id UUID REFERENCES ledger.financial_operations(id) ON DELETE RESTRICT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 5. Journal Entries (Immutable Accounting Book)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger.journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id BIGSERIAL NOT NULL UNIQUE,
    financial_operation_id UUID NOT NULL REFERENCES ledger.financial_operations(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    entry_type VARCHAR(64) NOT NULL,
    description TEXT NOT NULL,
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_operation_entry_type UNIQUE (financial_operation_id, entry_type)
);

-- -----------------------------------------------------------------------------
-- 6. Journal Lines (Individual Postings)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger.journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES ledger.journal_entries(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES ledger.ledger_accounts(id) ON DELETE RESTRICT,
    entry_number INT NOT NULL CHECK (entry_number > 0),
    direction ledger.balance_direction NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency CHAR(3) NOT NULL DEFAULT 'ARS',
    CONSTRAINT uq_entry_line_number UNIQUE (journal_entry_id, entry_number)
);

CREATE INDEX IF NOT EXISTS idx_journal_lines_account_lookup 
ON ledger.journal_lines(account_id, journal_entry_id);

-- -----------------------------------------------------------------------------
-- 7. Funds Reservations (Strategy B: Accounted Transit Sub-Accounts)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger.funds_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL REFERENCES ledger.financial_operations(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES ledger.ledger_accounts(id) ON DELETE RESTRICT,
    reserved_account_id UUID NOT NULL REFERENCES ledger.ledger_accounts(id) ON DELETE RESTRICT,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency CHAR(3) NOT NULL DEFAULT 'ARS',
    status ledger.reservation_status NOT NULL DEFAULT 'ACTIVE',
    creation_journal_entry_id UUID NOT NULL REFERENCES ledger.journal_entries(id) ON DELETE RESTRICT,
    settlement_journal_entry_id UUID REFERENCES ledger.journal_entries(id) ON DELETE RESTRICT,
    settlement_client_ref VARCHAR(255),
    release_journal_entry_id UUID REFERENCES ledger.journal_entries(id) ON DELETE RESTRICT,
    release_client_ref VARCHAR(255),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funds_reservations_status_expires 
ON ledger.funds_reservations(status, expires_at);

-- -----------------------------------------------------------------------------
-- 8. Transactional Outbox (Guaranteed At-Least-Once Delivery)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger.outbox_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type VARCHAR(64) NOT NULL,
    aggregate_id VARCHAR(255) NOT NULL,
    event_type VARCHAR(128) NOT NULL,
    payload JSONB NOT NULL,
    status ledger.outbox_status NOT NULL DEFAULT 'PENDING',
    retry_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    dispatched_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending_events 
ON ledger.outbox_events(status, created_at) 
WHERE status = 'PENDING';

-- -----------------------------------------------------------------------------
-- 9. API-Level Idempotency Transit Buffer (48-Hour TTL)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger.idempotency_records (
    idempotency_key VARCHAR(255) PRIMARY KEY,
    scope VARCHAR(64) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL,
    response_code INT,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours')
);

-- Assign ownership of all created tables to spbk_ledger_owner
ALTER TABLE ledger.ledger_accounts OWNER TO spbk_ledger_owner;
ALTER TABLE ledger.account_balances OWNER TO spbk_ledger_owner;
ALTER TABLE ledger.financial_operations OWNER TO spbk_ledger_owner;
ALTER TABLE ledger.journal_entries OWNER TO spbk_ledger_owner;
ALTER TABLE ledger.journal_lines OWNER TO spbk_ledger_owner;
ALTER TABLE ledger.funds_reservations OWNER TO spbk_ledger_owner;
ALTER TABLE ledger.outbox_events OWNER TO spbk_ledger_owner;
ALTER TABLE ledger.idempotency_records OWNER TO spbk_ledger_owner;
