-- =============================================================================
-- SaintPatrickBK PostgreSQL 18 Initialization Script
-- Environment: Development & Local Testing
-- Note: Final ledger tables and triggers are intentionally omitted per Phase 2.
-- =============================================================================

-- Ensure required extension capabilities are installed
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create dedicated test database if not exists
SELECT 'CREATE DATABASE saintpatrickbk_test OWNER spbk_admin'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'saintpatrickbk_test')\gexec

-- Grant privileges on development database
GRANT ALL PRIVILEGES ON DATABASE saintpatrickbk_dev TO spbk_admin;
GRANT ALL PRIVILEGES ON DATABASE saintpatrickbk_test TO spbk_admin;

-- Connect to test database to install core extensions
\c saintpatrickbk_test
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Connect back to dev database
\c saintpatrickbk_dev

-- Create restricted application role (non-superuser) for least-privilege operations
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'spbk_app') THEN
        CREATE ROLE spbk_app WITH LOGIN PASSWORD 'spbk_app_dev_secret';
    END IF;
END
$$;

-- Grant connect and schema usage to restricted app role
GRANT CONNECT ON DATABASE saintpatrickbk_dev TO spbk_app;
GRANT CONNECT ON DATABASE saintpatrickbk_test TO spbk_app;
GRANT USAGE, CREATE ON SCHEMA public TO spbk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO spbk_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO spbk_app;
