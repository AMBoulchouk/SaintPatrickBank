-- =============================================================================
-- SaintPatrickBK Ledger Core - Experimental DDL Specification
-- Database: PostgreSQL 18 (Disposable Testcontainers Environment)
-- Standard: Zero-Trust Relational Accounting & Cryptographic Invariants
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS ledger;

-- -----------------------------------------------------------------------------
-- 1. Types & Enumerations
-- -----------------------------------------------------------------------------
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_class' AND typnamespace = 'ledger'::regnamespace) THEN
        CREATE TYPE ledger.account_class AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'balance_direction' AND typnamespace = 'ledger'::regnamespace) THEN
        CREATE TYPE ledger.balance_direction AS ENUM ('DEBIT', 'CREDIT');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'account_status' AND typnamespace = 'ledger'::regnamespace) THEN
        CREATE TYPE ledger.account_status AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'operation_status' AND typnamespace = 'ledger'::regnamespace) THEN
        CREATE TYPE ledger.operation_status AS ENUM (
            'INITIATED',
            'PENDING_FUNDS_RESERVATION',
            'PENDING_EXTERNAL_CONFIRMATION',
            'CONFIRMED',
            'REJECTED',
            'REVERSED'
        );
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'outbox_status' AND typnamespace = 'ledger'::regnamespace) THEN
        CREATE TYPE ledger.outbox_status AS ENUM ('PENDING', 'DISPATCHED', 'FAILED');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'reservation_status' AND typnamespace = 'ledger'::regnamespace) THEN
        CREATE TYPE ledger.reservation_status AS ENUM ('ACTIVE', 'SETTLED', 'RELEASED', 'EXPIRED');
    END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- 2. Ledger Accounts (Chart of Accounts Nodes)
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
    CONSTRAINT chk_currency_format CHECK (currency ~ '^[A-Z]{3}$')
);

-- -----------------------------------------------------------------------------
-- 3. Materialized Account Balances (Point-in-Time Projection & Concurrency Anchor)
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
    CONSTRAINT chk_balance_consistency CHECK (
        cleared_balance_cents = available_balance_cents + reserved_balance_cents
    )
);

-- -----------------------------------------------------------------------------
-- 4. Financial Business Operations
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger.financial_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_reference_id VARCHAR(255) NOT NULL UNIQUE,
    operation_type VARCHAR(64) NOT NULL,
    status ledger.operation_status NOT NULL DEFAULT 'INITIATED',
    source_account_id UUID REFERENCES ledger.ledger_accounts(id),
    destination_account_id UUID REFERENCES ledger.ledger_accounts(id),
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency CHAR(3) NOT NULL DEFAULT 'ARS',
    reversal_of_id UUID REFERENCES ledger.financial_operations(id),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 5. Operational Reservations Tracker (Strategy B: Correlated with Ledger Subaccounts)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger.funds_reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    operation_id UUID NOT NULL REFERENCES ledger.financial_operations(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES ledger.ledger_accounts(id) ON DELETE RESTRICT,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency CHAR(3) NOT NULL DEFAULT 'ARS',
    status ledger.reservation_status NOT NULL DEFAULT 'ACTIVE',
    reservation_entry_id UUID, -- Will link to journal_entries
    settlement_entry_id UUID,  -- Set when settled
    storno_entry_id UUID,      -- Set when released/expired
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 6. Journal Entries (Immutable Accounting Book)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger.journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id BIGSERIAL NOT NULL UNIQUE,
    financial_operation_id UUID NOT NULL REFERENCES ledger.financial_operations(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    entry_type VARCHAR(64) NOT NULL,
    description TEXT NOT NULL,
    posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_locked BOOLEAN NOT NULL DEFAULT FALSE,
    CONSTRAINT uq_operation_entry_type UNIQUE (financial_operation_id, entry_type)
);

-- -----------------------------------------------------------------------------
-- 7. Journal Lines (Individual Postings)
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
-- 8. Transactional Outbox
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
-- 9. API-Level Idempotency Transit Records (48-Hour TTL)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ledger.idempotency_records (
    idempotency_key VARCHAR(255) PRIMARY KEY,
    scope VARCHAR(64) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL, -- 'PROCESSING', 'COMPLETED', 'FAILED'
    response_code INT,
    response_body JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '48 hours')
);

-- -----------------------------------------------------------------------------
-- 10. Engine Triggers: Invariants & Real Immutability
-- -----------------------------------------------------------------------------

-- Trigger A: Enforce Zero-Sum Balance & Line Count >= 2 at COMMIT time
CREATE OR REPLACE FUNCTION ledger.fn_enforce_zero_sum_balance()
RETURNS TRIGGER AS $$
DECLARE
    v_net_balance BIGINT;
    v_line_count INT;
    v_entry_id UUID;
BEGIN
    v_entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

    SELECT 
        COUNT(*),
        COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_line_count, v_net_balance
    FROM ledger.journal_lines
    WHERE journal_entry_id = v_entry_id;

    IF v_line_count < 2 THEN
        RAISE EXCEPTION 'INV-01 VIOLATION: Journal Entry % has only % line(s). Minimum 2 lines required.',
            v_entry_id, v_line_count
            USING ERRCODE = '23514'; -- check_violation
    END IF;

    IF v_net_balance <> 0 THEN
        RAISE EXCEPTION 'INV-02 VIOLATION: Journal Entry % does not balance to zero. Net delta: % centavos.',
            v_entry_id, v_net_balance
            USING ERRCODE = '23514'; -- check_violation
    END IF;

    -- Lock the journal entry permanently so no further inserts can be added to it
    UPDATE ledger.journal_entries 
    SET is_locked = TRUE 
    WHERE id = v_entry_id AND is_locked = FALSE;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_verify_journal_balance ON ledger.journal_lines;
CREATE CONSTRAINT TRIGGER trg_verify_journal_balance
AFTER INSERT OR UPDATE OR DELETE ON ledger.journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ledger.fn_enforce_zero_sum_balance();

-- Trigger B: Prevent Modification or Deletion of Journal Entries
CREATE OR REPLACE FUNCTION ledger.fn_prevent_journal_entries_mutation()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Allow internal state transition from is_locked=FALSE to is_locked=TRUE during initial commit
        IF OLD.is_locked = FALSE AND NEW.is_locked = TRUE AND 
           OLD.id = NEW.id AND OLD.sequence_id = NEW.sequence_id AND OLD.posted_at = NEW.posted_at AND
           OLD.financial_operation_id = NEW.financial_operation_id AND
           OLD.idempotency_key = NEW.idempotency_key AND
           OLD.entry_type = NEW.entry_type AND
           OLD.description = NEW.description THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'INV-05 VIOLATION: Posted journal entries are strictly immutable. Cannot % row.', TG_OP
        USING ERRCODE = '23505';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_journal_entries_mutation ON ledger.journal_entries;
CREATE TRIGGER trg_prevent_journal_entries_mutation
BEFORE UPDATE OR DELETE ON ledger.journal_entries
FOR EACH ROW EXECUTE FUNCTION ledger.fn_prevent_journal_entries_mutation();

-- Trigger C: Prevent Mutation or Deletion of Journal Lines
CREATE OR REPLACE FUNCTION ledger.fn_prevent_journal_lines_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'INV-05 VIOLATION: Journal lines are strictly immutable. Cannot % row.', TG_OP
        USING ERRCODE = '23505';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_journal_lines_mutation ON ledger.journal_lines;
CREATE TRIGGER trg_prevent_journal_lines_mutation
BEFORE UPDATE OR DELETE ON ledger.journal_lines
FOR EACH ROW EXECUTE FUNCTION ledger.fn_prevent_journal_lines_mutation();

-- Trigger D: Prevent Appending New Lines to an Already Locked Entry (Post-Commit Insertion Guard)
CREATE OR REPLACE FUNCTION ledger.fn_prevent_append_to_locked_entry()
RETURNS TRIGGER AS $$
DECLARE
    v_locked BOOLEAN;
BEGIN
    SELECT is_locked INTO v_locked 
    FROM ledger.journal_entries 
    WHERE id = NEW.journal_entry_id;

    IF v_locked IS TRUE THEN
        RAISE EXCEPTION 'INV-05 VIOLATION: Cannot append new journal lines to entry %. Entry is already locked and posted.',
            NEW.journal_entry_id
            USING ERRCODE = '23505';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_append_to_locked_entry ON ledger.journal_lines;
CREATE TRIGGER trg_prevent_append_to_locked_entry
BEFORE INSERT ON ledger.journal_lines
FOR EACH ROW EXECUTE FUNCTION ledger.fn_prevent_append_to_locked_entry();

-- -----------------------------------------------------------------------------
-- 11. Transactional Engine Function (SECURITY DEFINER)
-- -----------------------------------------------------------------------------
-- Single authorized operational gateway for P2P transfers.
-- Enforces: Idempotency -> Deterministic Locking -> Funds Check -> Journal Posting -> Projection Update -> Outbox.
CREATE OR REPLACE FUNCTION ledger.fn_post_transfer(
    p_client_ref VARCHAR(255),
    p_idempotency_key VARCHAR(255),
    p_source_account_id UUID,
    p_dest_account_id UUID,
    p_amount_cents BIGINT,
    p_currency CHAR(3),
    p_description TEXT,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    out_operation_id UUID,
    out_journal_entry_id UUID,
    out_source_available BIGINT,
    out_dest_available BIGINT,
    out_posted_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ledger, pg_catalog, pg_temp
AS $$
DECLARE
    v_first_lock UUID;
    v_second_lock UUID;
    v_src_balance RECORD;
    v_dst_balance RECORD;
    v_src_account RECORD;
    v_dst_account RECORD;
    v_op_id UUID;
    v_entry_id UUID;
    v_posted_at TIMESTAMPTZ;
BEGIN
    -- 1. Validate Basic Arguments
    IF p_amount_cents <= 0 THEN
        RAISE EXCEPTION 'Amount must be strictly positive: % centavos', p_amount_cents USING ERRCODE = '22003';
    END IF;

    IF p_source_account_id = p_dest_account_id THEN
        RAISE EXCEPTION 'Source and destination accounts cannot be identical: %', p_source_account_id USING ERRCODE = '22023';
    END IF;

    -- 2. Validate Accounts & Currencies
    SELECT * INTO v_src_account FROM ledger.ledger_accounts WHERE id = p_source_account_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Source account % not found', p_source_account_id USING ERRCODE = '02000';
    END IF;

    SELECT * INTO v_dst_account FROM ledger.ledger_accounts WHERE id = p_dest_account_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Destination account % not found', p_dest_account_id USING ERRCODE = '02000';
    END IF;

    IF v_src_account.currency <> p_currency OR v_dst_account.currency <> p_currency THEN
        RAISE EXCEPTION 'Currency mismatch: transaction currency % does not match account currencies (% / %)',
            p_currency, v_src_account.currency, v_dst_account.currency USING ERRCODE = '22023';
    END IF;

    -- 3. Deterministic Lexicographical Lock Acquisition (Pessimistic Row Locks)
    IF p_source_account_id < p_dest_account_id THEN
        v_first_lock := p_source_account_id;
        v_second_lock := p_dest_account_id;
    ELSE
        v_first_lock := p_dest_account_id;
        v_second_lock := p_source_account_id;
    END IF;

    PERFORM 1 FROM ledger.account_balances WHERE account_id = v_first_lock FOR UPDATE;
    PERFORM 1 FROM ledger.account_balances WHERE account_id = v_second_lock FOR UPDATE;

    -- 4. Read Locked Balances
    SELECT * INTO v_src_balance FROM ledger.account_balances WHERE account_id = p_source_account_id;
    SELECT * INTO v_dst_balance FROM ledger.account_balances WHERE account_id = p_dest_account_id;

    -- 5. Availability Check (For Customer Accounts, available balance cannot be negative)
    IF v_src_account.account_class = 'LIABILITY' AND v_src_balance.available_balance_cents < p_amount_cents THEN
        RAISE EXCEPTION 'INSUFFICIENT_FUNDS: Account % has % available, requested %',
            p_source_account_id, v_src_balance.available_balance_cents, p_amount_cents
            USING ERRCODE = '55000';
    END IF;

    -- 6. Insert Financial Operation
    INSERT INTO ledger.financial_operations (
        client_reference_id, operation_type, status, source_account_id, destination_account_id,
        amount_cents, currency, metadata
    ) VALUES (
        p_client_ref, 'P2P_TRANSFER', 'CONFIRMED', p_source_account_id, p_dest_account_id,
        p_amount_cents, p_currency, p_metadata
    ) RETURNING id INTO v_op_id;

    -- 7. Insert Immutable Journal Entry
    INSERT INTO ledger.journal_entries (
        financial_operation_id, idempotency_key, entry_type, description, is_locked
    ) VALUES (
        v_op_id, p_idempotency_key, 'TRANSFER_SETTLEMENT', p_description, FALSE
    ) RETURNING ledger.journal_entries.id, ledger.journal_entries.posted_at INTO v_entry_id, v_posted_at;

    -- 8. Insert Balanced Journal Lines (DEBIT sender, CREDIT receiver for Liabilities)
    INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
    VALUES 
        (v_entry_id, p_source_account_id, 1, 'DEBIT', p_amount_cents, p_currency),
        (v_entry_id, p_dest_account_id, 2, 'CREDIT', p_amount_cents, p_currency);

    -- 9. Update Materialized Balances Atomically
    UPDATE ledger.account_balances
    SET 
        cleared_balance_cents = cleared_balance_cents - p_amount_cents,
        available_balance_cents = available_balance_cents - p_amount_cents,
        version = version + 1,
        updated_at = NOW()
    WHERE account_id = p_source_account_id
    RETURNING available_balance_cents INTO out_source_available;

    UPDATE ledger.account_balances
    SET 
        cleared_balance_cents = cleared_balance_cents + p_amount_cents,
        available_balance_cents = available_balance_cents + p_amount_cents,
        version = version + 1,
        updated_at = NOW()
    WHERE account_id = p_dest_account_id
    RETURNING available_balance_cents INTO out_dest_available;

    -- 10. Persist Outbox Event
    INSERT INTO ledger.outbox_events (aggregate_type, aggregate_id, event_type, payload)
    VALUES (
        'TRANSFER',
        v_op_id::text,
        'TransferCompletedEvent',
        jsonb_build_object(
            'operationId', v_op_id,
            'journalEntryId', v_entry_id,
            'sourceAccountId', p_source_account_id,
            'destAccountId', p_dest_account_id,
            'amountCents', p_amount_cents::text,
            'currency', p_currency,
            'postedAt', v_posted_at
        )
    );

    out_operation_id := v_op_id;
    out_journal_entry_id := v_entry_id;
    out_posted_at := v_posted_at;
    RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- 12. Independent Audit Function (Reconciliation & Discrepancy Detection)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.fn_audit_reconcile_balances()
RETURNS TABLE (
    account_id UUID,
    account_code VARCHAR(64),
    materialized_cleared BIGINT,
    sum_calculated_cents BIGINT,
    discrepancy_cents BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ledger, pg_catalog, pg_temp
AS $$
    SELECT 
        b.account_id,
        a.code AS account_code,
        b.cleared_balance_cents AS materialized_cleared,
        COALESCE(
            SUM(
                CASE 
                    WHEN a.normal_balance = 'CREDIT' THEN
                        CASE WHEN l.direction = 'CREDIT' THEN l.amount_cents ELSE -l.amount_cents END
                    ELSE
                        CASE WHEN l.direction = 'DEBIT' THEN l.amount_cents ELSE -l.amount_cents END
                END
            ), 0
        ) AS sum_calculated_cents,
        (
            b.cleared_balance_cents - COALESCE(
                SUM(
                    CASE 
                        WHEN a.normal_balance = 'CREDIT' THEN
                            CASE WHEN l.direction = 'CREDIT' THEN l.amount_cents ELSE -l.amount_cents END
                        ELSE
                            CASE WHEN l.direction = 'DEBIT' THEN l.amount_cents ELSE -l.amount_cents END
                    END
                ), 0
            )
        ) AS discrepancy_cents
    FROM ledger.account_balances b
    JOIN ledger.ledger_accounts a ON a.id = b.account_id
    LEFT JOIN ledger.journal_lines l ON l.account_id = b.account_id
    GROUP BY b.account_id, a.code, b.cleared_balance_cents, a.normal_balance
    HAVING (
        b.cleared_balance_cents - COALESCE(
            SUM(
                CASE 
                    WHEN a.normal_balance = 'CREDIT' THEN
                        CASE WHEN l.direction = 'CREDIT' THEN l.amount_cents ELSE -l.amount_cents END
                    ELSE
                        CASE WHEN l.direction = 'DEBIT' THEN l.amount_cents ELSE -l.amount_cents END
                END
            ), 0
        )
    ) <> 0;
$$;
