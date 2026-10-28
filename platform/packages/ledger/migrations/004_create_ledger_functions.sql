-- =============================================================================
-- Migration 004: Create Authorized Transactional Ledger Functions
-- Authority: SaintPatrickBK Core Financial Architecture
-- Owner: spbk_ledger_owner (Non-Superuser)
-- Security: SECURITY DEFINER with fixed search_path = pg_catalog, ledger, pg_temp
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Atomic P2P Transfer Gateway
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.fn_post_transfer(
    p_client_ref VARCHAR(255),
    p_request_hash CHAR(64),
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
    out_posted_at TIMESTAMPTZ,
    out_is_idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ledger, pg_temp
AS $$
DECLARE
    v_existing_op RECORD;
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
    -- 1. Check Permanent Business Idempotency
    SELECT * INTO v_existing_op 
    FROM ledger.financial_operations 
    WHERE client_reference_id = p_client_ref;

    IF FOUND THEN
        IF v_existing_op.request_hash <> p_request_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Client reference % already exists with differing payload parameters.',
                p_client_ref USING ERRCODE = '23505';
        END IF;

        -- Safe idempotent replay: fetch original committed entry & current balances
        SELECT id, posted_at INTO v_entry_id, v_posted_at
        FROM ledger.journal_entries
        WHERE financial_operation_id = v_existing_op.id
        ORDER BY sequence_id ASC LIMIT 1;

        SELECT available_balance_cents INTO out_source_available
        FROM ledger.account_balances WHERE account_id = p_source_account_id;

        SELECT available_balance_cents INTO out_dest_available
        FROM ledger.account_balances WHERE account_id = p_dest_account_id;

        out_operation_id := v_existing_op.id;
        out_journal_entry_id := v_entry_id;
        out_posted_at := v_posted_at;
        out_is_idempotent_replay := TRUE;
        RETURN NEXT;
        RETURN;
    END IF;

    -- 2. Basic Parameter Validation
    IF p_amount_cents <= 0 THEN
        RAISE EXCEPTION 'Amount must be strictly positive: % centavos', p_amount_cents USING ERRCODE = '22003';
    END IF;

    IF p_source_account_id = p_dest_account_id THEN
        RAISE EXCEPTION 'Source and destination accounts cannot be identical: %', p_source_account_id USING ERRCODE = '22023';
    END IF;

    -- 3. Verify Accounts & Currencies
    SELECT * INTO v_src_account FROM ledger.ledger_accounts WHERE id = p_source_account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Source account % not found', p_source_account_id USING ERRCODE = '02000'; END IF;

    SELECT * INTO v_dst_account FROM ledger.ledger_accounts WHERE id = p_dest_account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Destination account % not found', p_dest_account_id USING ERRCODE = '02000'; END IF;

    IF v_src_account.currency <> p_currency OR v_dst_account.currency <> p_currency THEN
        RAISE EXCEPTION 'Currency mismatch: transaction currency % does not match accounts (% / %)',
            p_currency, v_src_account.currency, v_dst_account.currency USING ERRCODE = '22023';
    END IF;

    -- 4. Deterministic Lexicographical Row Locking on account_balances
    IF p_source_account_id < p_dest_account_id THEN
        v_first_lock := p_source_account_id;
        v_second_lock := p_dest_account_id;
    ELSE
        v_first_lock := p_dest_account_id;
        v_second_lock := p_source_account_id;
    END IF;

    PERFORM 1 FROM ledger.account_balances WHERE account_id = v_first_lock FOR UPDATE;
    PERFORM 1 FROM ledger.account_balances WHERE account_id = v_second_lock FOR UPDATE;

    SELECT * INTO v_src_balance FROM ledger.account_balances WHERE account_id = p_source_account_id;
    SELECT * INTO v_dst_balance FROM ledger.account_balances WHERE account_id = p_dest_account_id;

    -- 5. Availability Verification (Customer Liability cannot overdraw)
    IF v_src_account.account_class = 'LIABILITY' AND v_src_balance.available_balance_cents < p_amount_cents THEN
        RAISE EXCEPTION 'INSUFFICIENT_FUNDS: Account % has % available, requested %',
            p_source_account_id, v_src_balance.available_balance_cents, p_amount_cents USING ERRCODE = '55000';
    END IF;

    -- 6. Insert Financial Operation
    INSERT INTO ledger.financial_operations (
        client_reference_id, request_hash, operation_type, status, source_account_id,
        destination_account_id, amount_cents, currency, metadata
    ) VALUES (
        p_client_ref, p_request_hash, 'P2P_TRANSFER', 'CONFIRMED', p_source_account_id,
        p_dest_account_id, p_amount_cents, p_currency, p_metadata
    ) RETURNING id INTO v_op_id;

    -- 7. Insert Journal Entry (is_locked begins as FALSE)
    INSERT INTO ledger.journal_entries (
        financial_operation_id, idempotency_key, entry_type, description, is_locked
    ) VALUES (
        v_op_id, p_idempotency_key, 'TRANSFER_SETTLEMENT', p_description, FALSE
    ) RETURNING ledger.journal_entries.id, ledger.journal_entries.posted_at INTO v_entry_id, v_posted_at;

    -- 8. Insert Balanced Journal Lines
    INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
    VALUES 
        (v_entry_id, p_source_account_id, 1, 'DEBIT', p_amount_cents, p_currency),
        (v_entry_id, p_dest_account_id, 2, 'CREDIT', p_amount_cents, p_currency);

    -- 9. Update Materialized Balances
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
        'TRANSFER', v_op_id::text, 'TransferCompletedEvent',
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
    out_is_idempotent_replay := FALSE;
    RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. Funds Reservation Gateway (Strategy B: Accounted Transit Sub-Accounts)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.fn_create_reservation(
    p_client_ref VARCHAR(255),
    p_request_hash CHAR(64),
    p_idempotency_key VARCHAR(255),
    p_account_id UUID,
    p_reserved_account_id UUID,
    p_amount_cents BIGINT,
    p_currency CHAR(3),
    p_expires_at TIMESTAMPTZ,
    p_description TEXT,
    p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (
    out_reservation_id UUID,
    out_operation_id UUID,
    out_journal_entry_id UUID,
    out_available_balance BIGINT,
    out_reserved_balance BIGINT,
    out_is_idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ledger, pg_temp
AS $$
DECLARE
    v_existing_op RECORD;
    v_existing_res RECORD;
    v_first_lock UUID;
    v_second_lock UUID;
    v_balance RECORD;
    v_op_id UUID;
    v_entry_id UUID;
    v_res_id UUID;
BEGIN
    -- 1. Idempotency Check
    SELECT * INTO v_existing_op 
    FROM ledger.financial_operations 
    WHERE client_reference_id = p_client_ref;

    IF FOUND THEN
        IF v_existing_op.request_hash <> p_request_hash THEN
            RAISE EXCEPTION 'IDEMPOTENCY_CONFLICT: Client reference % already exists with differing payload parameters.',
                p_client_ref USING ERRCODE = '23505';
        END IF;

        SELECT * INTO v_existing_res FROM ledger.funds_reservations WHERE operation_id = v_existing_op.id;
        SELECT available_balance_cents, reserved_balance_cents INTO out_available_balance, out_reserved_balance
        FROM ledger.account_balances WHERE account_id = p_account_id;

        out_reservation_id := v_existing_res.id;
        out_operation_id := v_existing_op.id;
        out_journal_entry_id := v_existing_res.creation_journal_entry_id;
        out_is_idempotent_replay := TRUE;
        RETURN NEXT;
        RETURN;
    END IF;

    IF p_amount_cents <= 0 THEN
        RAISE EXCEPTION 'Reservation amount must be strictly positive: % centavos', p_amount_cents USING ERRCODE = '22003';
    END IF;

    -- 2. Deterministic Row Locks
    IF p_account_id < p_reserved_account_id THEN
        v_first_lock := p_account_id;
        v_second_lock := p_reserved_account_id;
    ELSE
        v_first_lock := p_reserved_account_id;
        v_second_lock := p_account_id;
    END IF;

    PERFORM 1 FROM ledger.account_balances WHERE account_id = v_first_lock FOR UPDATE;
    PERFORM 1 FROM ledger.account_balances WHERE account_id = v_second_lock FOR UPDATE;

    SELECT * INTO v_balance FROM ledger.account_balances WHERE account_id = p_account_id;
    IF v_balance.available_balance_cents < p_amount_cents THEN
        RAISE EXCEPTION 'INSUFFICIENT_FUNDS: Account % has % available, requested reservation %',
            p_account_id, v_balance.available_balance_cents, p_amount_cents USING ERRCODE = '55000';
    END IF;

    -- 3. Insert Financial Operation
    INSERT INTO ledger.financial_operations (
        client_reference_id, request_hash, operation_type, status, source_account_id,
        destination_account_id, amount_cents, currency, metadata
    ) VALUES (
        p_client_ref, p_request_hash, 'FUNDS_RESERVATION', 'PENDING_FUNDS_RESERVATION',
        p_account_id, p_reserved_account_id, p_amount_cents, p_currency, p_metadata
    ) RETURNING id INTO v_op_id;

    -- 4. Insert Journal Entry
    INSERT INTO ledger.journal_entries (
        financial_operation_id, idempotency_key, entry_type, description, is_locked
    ) VALUES (
        v_op_id, p_idempotency_key, 'RESERVATION_HOLD', p_description, FALSE
    ) RETURNING ledger.journal_entries.id INTO v_entry_id;

    -- 5. Insert Lines: DEBIT Available Liability, CREDIT Reserved Liability
    INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
    VALUES 
        (v_entry_id, p_account_id, 1, 'DEBIT', p_amount_cents, p_currency),
        (v_entry_id, p_reserved_account_id, 2, 'CREDIT', p_amount_cents, p_currency);

    -- 6. Update Balances (Customer cleared balance stays intact; available drops, reserved rises)
    UPDATE ledger.account_balances
    SET 
        available_balance_cents = available_balance_cents - p_amount_cents,
        reserved_balance_cents = reserved_balance_cents + p_amount_cents,
        version = version + 1,
        updated_at = NOW()
    WHERE account_id = p_account_id
    RETURNING available_balance_cents, reserved_balance_cents INTO out_available_balance, out_reserved_balance;

    UPDATE ledger.account_balances
    SET 
        cleared_balance_cents = cleared_balance_cents + p_amount_cents,
        available_balance_cents = available_balance_cents + p_amount_cents,
        version = version + 1,
        updated_at = NOW()
    WHERE account_id = p_reserved_account_id;

    -- 7. Insert Funds Reservation Record
    INSERT INTO ledger.funds_reservations (
        operation_id, account_id, reserved_account_id, amount_cents, currency,
        status, creation_journal_entry_id, expires_at
    ) VALUES (
        v_op_id, p_account_id, p_reserved_account_id, p_amount_cents, p_currency,
        'ACTIVE', v_entry_id, p_expires_at
    ) RETURNING id INTO v_res_id;

    -- 8. Persist Outbox Event
    INSERT INTO ledger.outbox_events (aggregate_type, aggregate_id, event_type, payload)
    VALUES (
        'RESERVATION', v_res_id::text, 'ReservationCreatedEvent',
        jsonb_build_object(
            'reservationId', v_res_id,
            'operationId', v_op_id,
            'accountId', p_account_id,
            'reservedAccountId', p_reserved_account_id,
            'amountCents', p_amount_cents::text,
            'currency', p_currency,
            'expiresAt', p_expires_at
        )
    );

    out_reservation_id := v_res_id;
    out_operation_id := v_op_id;
    out_journal_entry_id := v_entry_id;
    out_is_idempotent_replay := FALSE;
    RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. Settle Reservation Gateway (Finalizes Outbound Settlement)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.fn_settle_reservation(
    p_reservation_id UUID,
    p_client_ref VARCHAR(255),
    p_request_hash CHAR(64),
    p_idempotency_key VARCHAR(255),
    p_destination_account_id UUID,
    p_settle_amount_cents BIGINT,
    p_description TEXT
)
RETURNS TABLE (
    out_operation_id UUID,
    out_journal_entry_id UUID,
    out_is_idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ledger, pg_temp
AS $$
DECLARE
    v_res RECORD;
    v_dest_account RECORD;
    v_entry_id UUID;
BEGIN
    -- 1. Lock Reservation Row Exclusively
    SELECT * INTO v_res 
    FROM ledger.funds_reservations 
    WHERE id = p_reservation_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'RESERVATION_NOT_FOUND: Reservation % does not exist', p_reservation_id USING ERRCODE = '02000';
    END IF;

    -- 2. State Transition & Double-Settlement Guard
    IF v_res.status = 'SETTLED' THEN
        -- Check if it is an exact idempotent replay of this settlement
        IF v_res.settlement_client_ref = p_client_ref THEN
            out_operation_id := v_res.operation_id;
            out_journal_entry_id := v_res.settlement_journal_entry_id;
            out_is_idempotent_replay := TRUE;
            RETURN NEXT;
            RETURN;
        END IF;
        RAISE EXCEPTION 'RESERVATION_ALREADY_SETTLED: Reservation % has already been settled.', p_reservation_id
            USING ERRCODE = '23505';
    END IF;

    IF v_res.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'RESERVATION_NOT_ACTIVE: Cannot settle reservation % with status %.', p_reservation_id, v_res.status
            USING ERRCODE = '55000';
    END IF;

    IF p_settle_amount_cents <> v_res.amount_cents THEN
        RAISE EXCEPTION 'Partial settlement not supported. Expected %, requested %', v_res.amount_cents, p_settle_amount_cents
            USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_dest_account FROM ledger.ledger_accounts WHERE id = p_destination_account_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Destination account % not found', p_destination_account_id USING ERRCODE = '02000'; END IF;

    -- 3. Lock Involved Balances
    PERFORM 1 FROM ledger.account_balances WHERE account_id = v_res.account_id FOR UPDATE;
    PERFORM 1 FROM ledger.account_balances WHERE account_id = v_res.reserved_account_id FOR UPDATE;
    PERFORM 1 FROM ledger.account_balances WHERE account_id = p_destination_account_id FOR UPDATE;

    -- 4. Create Settlement Journal Entry
    INSERT INTO ledger.journal_entries (
        financial_operation_id, idempotency_key, entry_type, description, is_locked
    ) VALUES (
        v_res.operation_id, p_idempotency_key, 'RESERVATION_SETTLEMENT', p_description, FALSE
    ) RETURNING ledger.journal_entries.id INTO v_entry_id;

    -- 5. Lines: DEBIT Reserved Liability, CREDIT Destination (Asset 1101 or merchant)
    INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
    VALUES 
        (v_entry_id, v_res.reserved_account_id, 1, 'DEBIT', p_settle_amount_cents, v_res.currency),
        (v_entry_id, p_destination_account_id, 2, 'CREDIT', p_settle_amount_cents, v_res.currency);

    -- 6. Update Materialized Balances
    -- Customer liability cleared and reserved both decrease:
    UPDATE ledger.account_balances
    SET 
        cleared_balance_cents = cleared_balance_cents - p_settle_amount_cents,
        reserved_balance_cents = reserved_balance_cents - p_settle_amount_cents,
        version = version + 1,
        updated_at = NOW()
    WHERE account_id = v_res.account_id;

    UPDATE ledger.account_balances
    SET 
        cleared_balance_cents = cleared_balance_cents - p_settle_amount_cents,
        available_balance_cents = available_balance_cents - p_settle_amount_cents,
        version = version + 1,
        updated_at = NOW()
    WHERE account_id = v_res.reserved_account_id;

    -- Destination account balance updated according to polarity:
    IF v_dest_account.account_class = 'ASSET' THEN
        UPDATE ledger.account_balances
        SET 
            cleared_balance_cents = cleared_balance_cents - p_settle_amount_cents,
            available_balance_cents = available_balance_cents - p_settle_amount_cents,
            version = version + 1,
            updated_at = NOW()
        WHERE account_id = p_destination_account_id;
    ELSE
        UPDATE ledger.account_balances
        SET 
            cleared_balance_cents = cleared_balance_cents + p_settle_amount_cents,
            available_balance_cents = available_balance_cents + p_settle_amount_cents,
            version = version + 1,
            updated_at = NOW()
        WHERE account_id = p_destination_account_id;
    END IF;

    -- 7. Mark Reservation Settled
    UPDATE ledger.funds_reservations
    SET 
        status = 'SETTLED',
        settlement_journal_entry_id = v_entry_id,
        settlement_client_ref = p_client_ref,
        updated_at = NOW()
    WHERE id = p_reservation_id;

    UPDATE ledger.financial_operations
    SET status = 'CONFIRMED', updated_at = NOW()
    WHERE id = v_res.operation_id;

    -- 8. Persist Outbox Event
    INSERT INTO ledger.outbox_events (aggregate_type, aggregate_id, event_type, payload)
    VALUES (
        'RESERVATION', p_reservation_id::text, 'ReservationSettledEvent',
        jsonb_build_object(
            'reservationId', p_reservation_id,
            'operationId', v_res.operation_id,
            'journalEntryId', v_entry_id,
            'settledAmountCents', p_settle_amount_cents::text,
            'destinationAccountId', p_destination_account_id
        )
    );

    out_operation_id := v_res.operation_id;
    out_journal_entry_id := v_entry_id;
    out_is_idempotent_replay := FALSE;
    RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Release Reservation Gateway (Compensatory Storno back to Available)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.fn_release_reservation(
    p_reservation_id UUID,
    p_client_ref VARCHAR(255),
    p_request_hash CHAR(64),
    p_idempotency_key VARCHAR(255),
    p_reason VARCHAR(64),
    p_description TEXT
)
RETURNS TABLE (
    out_operation_id UUID,
    out_journal_entry_id UUID,
    out_is_idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ledger, pg_temp
AS $$
DECLARE
    v_res RECORD;
    v_entry_id UUID;
    v_target_status ledger.reservation_status;
BEGIN
    SELECT * INTO v_res 
    FROM ledger.funds_reservations 
    WHERE id = p_reservation_id 
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'RESERVATION_NOT_FOUND: Reservation % does not exist', p_reservation_id USING ERRCODE = '02000';
    END IF;

    IF v_res.status = 'SETTLED' THEN
        RAISE EXCEPTION 'CANNOT_RELEASE_SETTLED_RESERVATION: Reservation % is already settled and cannot be released.',
            p_reservation_id USING ERRCODE = '55000';
    END IF;

    IF v_res.status IN ('RELEASED', 'EXPIRED') THEN
        IF v_res.release_client_ref = p_client_ref THEN
            out_operation_id := v_res.operation_id;
            out_journal_entry_id := v_res.release_journal_entry_id;
            out_is_idempotent_replay := TRUE;
            RETURN NEXT;
            RETURN;
        END IF;
        RAISE EXCEPTION 'RESERVATION_ALREADY_RELEASED: Reservation % has already been released.', p_reservation_id
            USING ERRCODE = '23505';
    END IF;

    -- Lock Balances
    PERFORM 1 FROM ledger.account_balances WHERE account_id = v_res.account_id FOR UPDATE;
    PERFORM 1 FROM ledger.account_balances WHERE account_id = v_res.reserved_account_id FOR UPDATE;

    -- Create Compensatory Reversal Journal Entry
    INSERT INTO ledger.journal_entries (
        financial_operation_id, idempotency_key, entry_type, description, is_locked
    ) VALUES (
        v_res.operation_id, p_idempotency_key, 'RESERVATION_RELEASE', p_description, FALSE
    ) RETURNING ledger.journal_entries.id INTO v_entry_id;

    -- Lines: DEBIT Reserved Liability, CREDIT Available Liability (Restores Available Balance)
    INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
    VALUES 
        (v_entry_id, v_res.reserved_account_id, 1, 'DEBIT', v_res.amount_cents, v_res.currency),
        (v_entry_id, v_res.account_id, 2, 'CREDIT', v_res.amount_cents, v_res.currency);

    -- Update Balances
    UPDATE ledger.account_balances
    SET 
        available_balance_cents = available_balance_cents + v_res.amount_cents,
        reserved_balance_cents = reserved_balance_cents - v_res.amount_cents,
        version = version + 1,
        updated_at = NOW()
    WHERE account_id = v_res.account_id;

    UPDATE ledger.account_balances
    SET 
        cleared_balance_cents = cleared_balance_cents - v_res.amount_cents,
        available_balance_cents = available_balance_cents - v_res.amount_cents,
        version = version + 1,
        updated_at = NOW()
    WHERE account_id = v_res.reserved_account_id;

    v_target_status := CASE WHEN p_reason = 'EXPIRED' THEN 'EXPIRED'::ledger.reservation_status ELSE 'RELEASED'::ledger.reservation_status END;

    UPDATE ledger.funds_reservations
    SET 
        status = v_target_status,
        release_journal_entry_id = v_entry_id,
        release_client_ref = p_client_ref,
        updated_at = NOW()
    WHERE id = p_reservation_id;

    UPDATE ledger.financial_operations
    SET status = 'REJECTED', updated_at = NOW()
    WHERE id = v_res.operation_id;

    INSERT INTO ledger.outbox_events (aggregate_type, aggregate_id, event_type, payload)
    VALUES (
        'RESERVATION', p_reservation_id::text, 'ReservationReleasedEvent',
        jsonb_build_object(
            'reservationId', p_reservation_id,
            'operationId', v_res.operation_id,
            'journalEntryId', v_entry_id,
            'reason', p_reason
        )
    );

    out_operation_id := v_res.operation_id;
    out_journal_entry_id := v_entry_id;
    out_is_idempotent_replay := FALSE;
    RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. Post-Settlement Authorized Reversal Gateway (Chargeback / Storno)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.fn_post_reversal(
    p_original_operation_id UUID,
    p_client_ref VARCHAR(255),
    p_request_hash CHAR(64),
    p_idempotency_key VARCHAR(255),
    p_reason TEXT
)
RETURNS TABLE (
    out_reversal_op_id UUID,
    out_reversal_entry_id UUID,
    out_is_idempotent_replay BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ledger, pg_temp
AS $$
DECLARE
    v_orig_op RECORD;
    v_reversal_op_id UUID;
    v_reversal_entry_id UUID;
BEGIN
    SELECT * INTO v_orig_op 
    FROM ledger.financial_operations 
    WHERE id = p_original_operation_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'ORIGINAL_OPERATION_NOT_FOUND: Operation % not found', p_original_operation_id USING ERRCODE = '02000';
    END IF;

    IF v_orig_op.status <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'CANNOT_REVERSE_UNCONFIRMED: Operation % has status %, only CONFIRMED can be reversed.',
            p_original_operation_id, v_orig_op.status USING ERRCODE = '55000';
    END IF;

    -- Lock Balances
    PERFORM 1 FROM ledger.account_balances WHERE account_id = v_orig_op.source_account_id FOR UPDATE;
    PERFORM 1 FROM ledger.account_balances WHERE account_id = v_orig_op.destination_account_id FOR UPDATE;

    -- Insert Reversal Business Operation
    INSERT INTO ledger.financial_operations (
        client_reference_id, request_hash, operation_type, status, source_account_id,
        destination_account_id, amount_cents, currency, reversal_of_operation_id, metadata
    ) VALUES (
        p_client_ref, p_request_hash, 'REVERSAL', 'CONFIRMED', v_orig_op.destination_account_id,
        v_orig_op.source_account_id, v_orig_op.amount_cents, v_orig_op.currency, p_original_operation_id,
        jsonb_build_object('reason', p_reason)
    ) RETURNING id INTO v_reversal_op_id;

    -- Insert Reversal Journal Entry
    INSERT INTO ledger.journal_entries (
        financial_operation_id, idempotency_key, entry_type, description, is_locked
    ) VALUES (
        v_reversal_op_id, p_idempotency_key, 'COMPENSATORY_REVERSAL', 'Storno reversal of ' || p_original_operation_id, FALSE
    ) RETURNING ledger.journal_entries.id INTO v_reversal_entry_id;

    -- Invert original directions: Destination DEBIT, Source CREDIT
    INSERT INTO ledger.journal_lines (journal_entry_id, account_id, entry_number, direction, amount_cents, currency)
    VALUES 
        (v_reversal_entry_id, v_orig_op.destination_account_id, 1, 'DEBIT', v_orig_op.amount_cents, v_orig_op.currency),
        (v_reversal_entry_id, v_orig_op.source_account_id, 2, 'CREDIT', v_orig_op.amount_cents, v_orig_op.currency);

    -- Update Balances
    UPDATE ledger.account_balances
    SET 
        cleared_balance_cents = cleared_balance_cents - v_orig_op.amount_cents,
        available_balance_cents = available_balance_cents - v_orig_op.amount_cents,
        version = version + 1,
        updated_at = NOW()
    WHERE account_id = v_orig_op.destination_account_id;

    UPDATE ledger.account_balances
    SET 
        cleared_balance_cents = cleared_balance_cents + v_orig_op.amount_cents,
        available_balance_cents = available_balance_cents + v_orig_op.amount_cents,
        version = version + 1,
        updated_at = NOW()
    WHERE account_id = v_orig_op.source_account_id;

    UPDATE ledger.financial_operations SET status = 'REVERSED', updated_at = NOW() WHERE id = p_original_operation_id;

    INSERT INTO ledger.outbox_events (aggregate_type, aggregate_id, event_type, payload)
    VALUES (
        'OPERATION', v_reversal_op_id::text, 'OperationReversedEvent',
        jsonb_build_object(
            'originalOperationId', p_original_operation_id,
            'reversalOperationId', v_reversal_op_id,
            'journalEntryId', v_reversal_entry_id,
            'reason', p_reason
        )
    );

    out_reversal_op_id := v_reversal_op_id;
    out_reversal_entry_id := v_reversal_entry_id;
    out_is_idempotent_replay := FALSE;
    RETURN NEXT;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. Independent Continuous Audit Reconciliation Gateway
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
SET search_path = pg_catalog, ledger, pg_temp
AS $$
    SELECT 
        b.account_id,
        a.code AS account_code,
        b.cleared_balance_cents AS materialized_cleared,
        COALESCE(SUM(
            CASE 
                WHEN a.normal_balance = 'CREDIT' THEN
                    CASE WHEN l.direction = 'CREDIT' THEN l.amount_cents ELSE -l.amount_cents END
                ELSE
                    CASE WHEN l.direction = 'DEBIT' THEN l.amount_cents ELSE -l.amount_cents END
            END
        ), 0)::BIGINT AS sum_calculated_cents,
        (b.cleared_balance_cents - COALESCE(SUM(
            CASE 
                WHEN a.normal_balance = 'CREDIT' THEN
                    CASE WHEN l.direction = 'CREDIT' THEN l.amount_cents ELSE -l.amount_cents END
                ELSE
                    CASE WHEN l.direction = 'DEBIT' THEN l.amount_cents ELSE -l.amount_cents END
            END
        ), 0))::BIGINT AS discrepancy_cents
    FROM ledger.account_balances b
    JOIN ledger.ledger_accounts a ON a.id = b.account_id
    LEFT JOIN ledger.journal_lines l ON l.account_id = b.account_id
    GROUP BY b.account_id, a.code, b.cleared_balance_cents, a.normal_balance;
$$;

-- Assign ownership of all created functions to spbk_ledger_owner
ALTER FUNCTION ledger.fn_post_transfer OWNER TO spbk_ledger_owner;
ALTER FUNCTION ledger.fn_create_reservation OWNER TO spbk_ledger_owner;
ALTER FUNCTION ledger.fn_settle_reservation OWNER TO spbk_ledger_owner;
ALTER FUNCTION ledger.fn_release_reservation OWNER TO spbk_ledger_owner;
ALTER FUNCTION ledger.fn_post_reversal OWNER TO spbk_ledger_owner;
ALTER FUNCTION ledger.fn_audit_reconcile_balances OWNER TO spbk_ledger_owner;
