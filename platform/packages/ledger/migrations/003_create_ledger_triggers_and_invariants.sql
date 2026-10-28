-- =============================================================================
-- Migration 003: Create Ledger Triggers, Mathematical Invariants, and Append Guards
-- Authority: SaintPatrickBK Core Financial Architecture
-- Owner: spbk_ledger_owner (Non-Superuser)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Deferred Constraint Trigger on journal_entries
-- Enforces: Non-empty, line count >= 2, zero-sum per currency, and auto-locks entry
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.fn_verify_journal_entry_commit()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ledger, pg_temp
AS $$
DECLARE
    v_line_count INT;
    v_unbalanced_currencies INT;
BEGIN
    -- 1. Check line count
    SELECT COUNT(*) INTO v_line_count
    FROM ledger.journal_lines
    WHERE journal_entry_id = NEW.id;

    IF v_line_count = 0 THEN
        RAISE EXCEPTION 'INV-01 VIOLATION: Journal Entry % has 0 lines. Empty journal entries are strictly forbidden.',
            NEW.id USING ERRCODE = '23514'; -- check_violation
    END IF;

    IF v_line_count < 2 THEN
        RAISE EXCEPTION 'INV-01 VIOLATION: Journal Entry % has only % line(s). Minimum 2 lines required for double-entry.',
            NEW.id, v_line_count USING ERRCODE = '23514'; -- check_violation
    END IF;

    -- 2. Check balance per currency (EVERY distinct currency in the entry must balance to zero)
    SELECT COUNT(*) INTO v_unbalanced_currencies
    FROM (
        SELECT currency, SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE -amount_cents END) as delta
        FROM ledger.journal_lines
        WHERE journal_entry_id = NEW.id
        GROUP BY currency
        HAVING SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE -amount_cents END) <> 0
    ) unbalanced_sub;

    IF v_unbalanced_currencies > 0 THEN
        RAISE EXCEPTION 'INV-02 VIOLATION: Journal Entry % is unbalanced per currency. Net delta must equal zero for all currencies.',
            NEW.id USING ERRCODE = '23514'; -- check_violation
    END IF;

    -- 3. Transition is_locked from FALSE to TRUE
    UPDATE ledger.journal_entries
    SET is_locked = TRUE
    WHERE id = NEW.id AND is_locked = FALSE;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_verify_journal_entry_commit ON ledger.journal_entries;
CREATE CONSTRAINT TRIGGER trg_verify_journal_entry_commit
AFTER INSERT ON ledger.journal_entries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ledger.fn_verify_journal_entry_commit();

-- -----------------------------------------------------------------------------
-- 2. Immutability Guard on journal_entries (Blocks UPDATE / DELETE)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.fn_prevent_journal_entries_mutation()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ledger, pg_temp
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Allow ONLY the internal transition is_locked=FALSE -> is_locked=TRUE during transaction commit
        IF OLD.is_locked = FALSE AND NEW.is_locked = TRUE AND
           OLD.id = NEW.id AND 
           OLD.sequence_id = NEW.sequence_id AND 
           OLD.financial_operation_id = NEW.financial_operation_id AND
           OLD.idempotency_key = NEW.idempotency_key AND
           OLD.entry_type = NEW.entry_type AND
           OLD.description = NEW.description AND
           OLD.posted_at = NEW.posted_at THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'INV-05 VIOLATION: Journal entries are immutable. Cannot % row %.', TG_OP, OLD.id
        USING ERRCODE = '23505'; -- restrictive error code
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_journal_entries_mutation ON ledger.journal_entries;
CREATE TRIGGER trg_prevent_journal_entries_mutation
BEFORE UPDATE OR DELETE ON ledger.journal_entries
FOR EACH ROW EXECUTE FUNCTION ledger.fn_prevent_journal_entries_mutation();

-- -----------------------------------------------------------------------------
-- 3. Immutability Guard on journal_lines (Blocks UPDATE / DELETE)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.fn_prevent_journal_lines_mutation()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ledger, pg_temp
AS $$
BEGIN
    RAISE EXCEPTION 'INV-05 VIOLATION: Journal lines are strictly immutable. Cannot % line %.', TG_OP, OLD.id
        USING ERRCODE = '23505';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_journal_lines_mutation ON ledger.journal_lines;
CREATE TRIGGER trg_prevent_journal_lines_mutation
BEFORE UPDATE OR DELETE ON ledger.journal_lines
FOR EACH ROW EXECUTE FUNCTION ledger.fn_prevent_journal_lines_mutation();

-- -----------------------------------------------------------------------------
-- 4. Post-Commit Append Guard (Blocks INSERT on locked journal entries)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.fn_prevent_append_to_locked_entry()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ledger, pg_temp
AS $$
DECLARE
    v_locked BOOLEAN;
BEGIN
    SELECT is_locked INTO v_locked 
    FROM ledger.journal_entries 
    WHERE id = NEW.journal_entry_id;

    IF v_locked IS TRUE THEN
        RAISE EXCEPTION 'INV-05 VIOLATION: Cannot append new journal lines to entry %. Entry is already locked and committed.',
            NEW.journal_entry_id USING ERRCODE = '23505';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_append_to_locked_entry ON ledger.journal_lines;
CREATE TRIGGER trg_prevent_append_to_locked_entry
BEFORE INSERT ON ledger.journal_lines
FOR EACH ROW EXECUTE FUNCTION ledger.fn_prevent_append_to_locked_entry();

-- -----------------------------------------------------------------------------
-- 5. Currency Consistency Guard (Line currency must match Account currency)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.fn_check_line_currency_matches_account()
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, ledger, pg_temp
AS $$
DECLARE
    v_account_currency CHAR(3);
BEGIN
    SELECT currency INTO v_account_currency 
    FROM ledger.ledger_accounts 
    WHERE id = NEW.account_id;

    IF v_account_currency IS NULL THEN
        RAISE EXCEPTION 'INV-04 VIOLATION: Account % not found for journal line.', NEW.account_id
            USING ERRCODE = '02000';
    END IF;

    IF v_account_currency <> NEW.currency THEN
        RAISE EXCEPTION 'INV-04 VIOLATION: Currency mismatch. Line currency % does not match account currency % for account %.',
            NEW.currency, v_account_currency, NEW.account_id
            USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_check_line_currency_matches_account ON ledger.journal_lines;
CREATE TRIGGER trg_check_line_currency_matches_account
BEFORE INSERT ON ledger.journal_lines
FOR EACH ROW EXECUTE FUNCTION ledger.fn_check_line_currency_matches_account();

-- Assign ownership of functions to spbk_ledger_owner
ALTER FUNCTION ledger.fn_verify_journal_entry_commit OWNER TO spbk_ledger_owner;
ALTER FUNCTION ledger.fn_prevent_journal_entries_mutation OWNER TO spbk_ledger_owner;
ALTER FUNCTION ledger.fn_prevent_journal_lines_mutation OWNER TO spbk_ledger_owner;
ALTER FUNCTION ledger.fn_prevent_append_to_locked_entry OWNER TO spbk_ledger_owner;
ALTER FUNCTION ledger.fn_check_line_currency_matches_account OWNER TO spbk_ledger_owner;
