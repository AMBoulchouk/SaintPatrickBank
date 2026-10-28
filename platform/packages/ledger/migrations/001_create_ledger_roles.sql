-- =============================================================================
-- Migration 001: Create Ledger Roles with Least Privileges
-- Authority: SaintPatrickBK Core Security Architecture
-- =============================================================================

DO $$
BEGIN
    -- 1. Dedicated Ledger Schema & Object Owner (Non-Superuser)
    -- All SECURITY DEFINER functions will execute under this role's authority.
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spbk_ledger_owner') THEN
        CREATE ROLE spbk_ledger_owner WITH 
            LOGIN 
            PASSWORD 'spbk_owner_secret_dev' 
            NOSUPERUSER 
            NOCREATEDB 
            NOCREATEROLE 
            NOINHERIT;
    END IF;

    -- 2. Dedicated Migration Execution Role (Non-Superuser)
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spbk_migrator') THEN
        CREATE ROLE spbk_migrator WITH 
            LOGIN 
            PASSWORD 'spbk_migrator_secret_dev' 
            NOSUPERUSER 
            NOCREATEDB 
            NOCREATEROLE;
    END IF;

    -- 3. Dedicated Application Runtime Role (Non-Superuser)
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spbk_app') THEN
        CREATE ROLE spbk_app WITH 
            LOGIN 
            PASSWORD 'spbk_app_dev_secret' 
            NOSUPERUSER 
            NOCREATEDB 
            NOCREATEROLE;
    END IF;
END
$$;
