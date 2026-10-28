-- =============================================================================
-- Migration 005: Enforce Role-Based Least Privilege & Revoke Public Access
-- Authority: SaintPatrickBK Core Security Architecture
-- =============================================================================

-- 1. Strip all privileges from PUBLIC on schema and all objects
REVOKE ALL ON SCHEMA ledger FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ledger FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA ledger FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ledger FROM PUBLIC;

-- 2. Restrict Migration Role (spbk_migrator)
GRANT USAGE, CREATE ON SCHEMA ledger TO spbk_migrator;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA ledger TO spbk_migrator;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA ledger TO spbk_migrator;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA ledger TO spbk_migrator;

-- 3. Configure Runtime Application Role (spbk_app)
-- Schema access: USAGE only (CREATE is strictly revoked to block tampering)
GRANT USAGE ON SCHEMA ledger TO spbk_app;
REVOKE CREATE ON SCHEMA ledger FROM spbk_app;

-- Read-only visibility across ledger projection and audit tables
GRANT SELECT ON ALL TABLES IN SCHEMA ledger TO spbk_app;

-- Dedicated access to API transit buffer
GRANT SELECT, INSERT, UPDATE ON ledger.idempotency_records TO spbk_app;

-- Explicit Execution Rights on Authorized Transactional Functions ONLY
GRANT EXECUTE ON FUNCTION ledger.fn_post_transfer TO spbk_app;
GRANT EXECUTE ON FUNCTION ledger.fn_create_reservation TO spbk_app;
GRANT EXECUTE ON FUNCTION ledger.fn_settle_reservation TO spbk_app;
GRANT EXECUTE ON FUNCTION ledger.fn_release_reservation TO spbk_app;
GRANT EXECUTE ON FUNCTION ledger.fn_post_reversal TO spbk_app;
GRANT EXECUTE ON FUNCTION ledger.fn_audit_reconcile_balances TO spbk_app;

-- 4. Inviolable Defense: Explicitly REVOKE direct write mutations from spbk_app
REVOKE INSERT, UPDATE, DELETE ON ledger.account_balances FROM spbk_app;
REVOKE INSERT, UPDATE, DELETE ON ledger.journal_entries FROM spbk_app;
REVOKE INSERT, UPDATE, DELETE ON ledger.journal_lines FROM spbk_app;
REVOKE INSERT, UPDATE, DELETE ON ledger.funds_reservations FROM spbk_app;
REVOKE INSERT, UPDATE, DELETE ON ledger.financial_operations FROM spbk_app;
REVOKE INSERT, UPDATE, DELETE ON ledger.outbox_events FROM spbk_app;
REVOKE UPDATE, DELETE ON ledger.ledger_accounts FROM spbk_app;
