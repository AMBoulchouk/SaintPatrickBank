# SaintPatrickBK Ledger Core: Formal Architecture, Data Model, and Invariants

**Document Status:** Formal Architecture & Mathematical Blueprint (Phase 3 Design)  
**Authority:** Core Financial Systems Architecture  
**Target Engine:** PostgreSQL 18 | TypeScript Strict | Node.js 24 LTS  
**Review Status:** Pending Implementation Approval (Strict Design Specification)

---

## 1. Executive Summary & Core Philosophy

The **Ledger Core** is the definitive, immutable financial authority of SaintPatrickBK. In a regulated financial platform operating under Central Bank of Argentina (**BCRA**) and **UIF** standards, account balances are never treated as raw mutable numbers stored in arbitrary tables. **A balance is a deterministic, mathematically verifiable projection of an immutable double-entry journal.**

This document details the complete data model, mathematical invariants, concurrency control protocols, transactional boundaries, and proposed PostgreSQL 18 DDL for the Ledger Core. In strict compliance with Phase 3 instructions, **this document serves as a design contract; no financial tables or triggers are to be executed until formally authorized.**

---

## 2. Entity-Relationship Model & Bounded Context Layout

### 2.1. Entity Map & Separation of Responsibilities

```
+----------------------------------------------------------------------------------------------------+
|                                      BUSINESS OPERATIONS LAYER                                     |
|                                                                                                    |
|   +--------------------------+                         +---------------------------------------+   |
|   |   financial_operations   | 1                     * |          funds_reservations           |   |
|   |--------------------------|<------------------------|---------------------------------------|   |
|   | id (UUID PK)             |                         | id (UUID PK)                          |   |
|   | operation_type (VARCHAR) |                         | operation_id (UUID FK)                |   |
|   | status (ENUM)            |                         | account_id (UUID FK)                  |   |
|   | correlation_id (VARCHAR) |                         | amount_cents (BIGINT > 0)             |   |
|   | client_reference_id (UNQ)|                         | status (ACTIVE/RELEASED/SETTLED)      |   |
|   | initiated_at (TIMESTAMPTZ|                         | expires_at (TIMESTAMPTZ)              |   |
|   +--------------------------+                         +---------------------------------------+   |
|                | 1                                                                                 |
+----------------|-----------------------------------------------------------------------------------+
                 |
                 | 1..* (An operation can yield multiple balanced journal entries over its lifecycle)
                 v
+----------------------------------------------------------------------------------------------------+
|                                    DOUBLE-ENTRY ACCOUNTING CORE                                    |
|                                                                                                    |
|   +--------------------------+                         +---------------------------------------+   |
|   |     journal_entries      | 1                     * |             journal_lines             |   |
|   |--------------------------|<------------------------|---------------------------------------|   |
|   | id (UUID PK)             |                         | id (UUID PK)                          |   |
|   | sequence_id (BIGSERIAL)  |                         | journal_entry_id (UUID FK RESTRICT)   |   |
|   | financial_op_id (UUID FK)|                         | account_id (UUID FK RESTRICT)         |   |
|   | idempotency_key (UNQ)    |                         | entry_number (INT 1..N)               |   |
|   | entry_type (VARCHAR)     |                         | direction (DEBIT / CREDIT)            |   |
|   | status (POSTED)          |                         | amount_cents (BIGINT > 0)             |   |
|   | posted_at (TIMESTAMPTZ)  |                         | currency (CHAR(3) ISO-4217)           |   |
|   +--------------------------+                         +---------------------------------------+   |
|                                                                    | *                             |
|                                                                    v 1                             |
|   +--------------------------+ 1                     1 +---------------------------------------+   |
|   |     account_balances     |------------------------>|            ledger_accounts            |   |
|   |--------------------------|                         |---------------------------------------|   |
|   | account_id (UUID PK FK)  |                         | id (UUID PK)                          |   |
|   | cleared_balance_cents    |                         | code (VARCHAR(64) UNIQUE)             |   |
|   | reserved_balance_cents   |                         | account_class (ASSET/LIAB/EQU/REV/EXP)|   |
|   | available_balance_cents  |                         | normal_balance (DEBIT / CREDIT)       |   |
|   | version (BIGINT)         |                         | currency (CHAR(3))                    |   |
|   | updated_at (TIMESTAMPTZ) |                         | status (ACTIVE / FROZEN / CLOSED)     |   |
|   +--------------------------+                         +---------------------------------------+   |
+----------------------------------------------------------------------------------------------------+
                 |
                 | (Written in the same serializable PostgreSQL transaction)
                 v
+----------------------------------------------------------------------------------------------------+
|                                ASYNCHRONOUS RELIABILITY PRIMITIVES                                 |
|                                                                                                    |
|   +------------------------------------+             +-----------------------------------------+   |
|   |           outbox_events            |             |           idempotency_records           |   |
|   |------------------------------------|             |-----------------------------------------|   |
|   | id (UUID PK)                       |             | idempotency_key (VARCHAR(255) PK)       |   |
|   | event_type (VARCHAR)               |             | scope (VARCHAR(64))                     |   |
|   | aggregate_type (VARCHAR)           |             | request_hash (CHAR(64) SHA-256)         |   |
|   | aggregate_id (VARCHAR)             |             | status (PROCESSING / COMPLETED / FAILED)|   |
|   | payload_json (JSONB)               |             | response_code (INT)                     |   |
|   | status (PENDING/DISPATCHED/FAILED) |             | response_body (JSONB)                   |   |
|   | created_at (TIMESTAMPTZ)           |             | expires_at (TIMESTAMPTZ, 48h TTL)       |   |
|   +------------------------------------+             +-----------------------------------------+   |
+----------------------------------------------------------------------------------------------------+
```

### 2.2. Boundary & Separation Justifications

1. **Why `financial_operations` is distinct from `journal_entries`:**
   * A financial business operation (e.g. an outbound bank transfer via COELSA) is an asynchronous business process that spans seconds, minutes, or even clearing cycles. It undergoes state transitions (`INITIATED` $\rightarrow$ `PENDING_EXTERNAL_CONFIRMATION` $\rightarrow$ `CONFIRMED` or `REJECTED`).
   * A `journal_entry` is an instantaneous, immutable accounting fact. It cannot transition across states once committed.
   * A single business operation frequently generates **multiple** journal entries:
     * *Stage 1 (Reservation):* Debits Customer Available Account, Credits In-Flight Reserved Liability.
     * *Stage 2a (Settlement):* Debits In-Flight Reserved Liability, Credits Commercial Bank Asset.
     * *Stage 2b (Rejection/Storno):* Offsetting reversal entry returning funds to Available.
2. **Why `account_balances` is a dedicated projection table:**
   * Calculating balances by executing `SELECT SUM(...) FROM journal_lines WHERE account_id = $1` on every read incurs catastrophic performance degradation as transaction volume scales into millions of rows.
   * `account_balances` stores the materialized point-in-time balance. Concurrency controls (`SELECT ... FOR UPDATE`) lock rows in `account_balances` rather than contending on immutable append-only `journal_lines` tables.
   * **Integrity Proof:** Because `account_balances` is updated in the exact same database transaction as `journal_lines`, and can be completely reconstructed from historical lines via audit scripts, it maintains 100% derivation fidelity.
3. **Why `idempotency_records` is distinct from transaction uniqueness:**
   * `idempotency_records` is an API-layer transit buffer with a **48-hour Time-to-Live (TTL)**, designed to cache and replay HTTP responses to flaky client network connections.
   * Permanent monetary deduplication is enforced independently by database unique constraints on `financial_operations.client_reference_id` and `journal_entries.idempotency_key`, which **never expire and are retained forever**.

---

## 3. Mandatory Mathematical Invariants

The Ledger Core enforces eleven foundational mathematical and structural invariants. If any single invariant is breached, the database engine physically rejects the transaction and rolls back all modifications.

### 3.1. Catalog of Invariants

| Invariant ID | Rule Name | Mathematical / Logical Expression | Enforcement Mechanism |
| :--- | :--- | :--- | :--- |
| **INV-01** | **Dual-Leg Rule** | $\text{Count}(\text{lines}) \ge 2$ per Journal Entry. | PostgreSQL constraint trigger validating line count at commit time. |
| **INV-02** | **Zero-Sum Balance** | $\sum_{i=1}^n \left( \text{amount}_i \cdot \delta_i \right) = 0$ where $\delta = +1$ for DEBIT and $-1$ for CREDIT, grouped by currency. | PostgreSQL deferred trigger verifying net balance equals 0 ARS at `COMMIT`. |
| **INV-03** | **Strictly Positive Postings** | $\forall \text{ line } i: \text{amount\_cents}_i > 0$. | Table check constraint: `CHECK (amount_cents > 0)`. Zero or negative lines prohibited. |
| **INV-04** | **No Orphan Postings** | $\forall \text{ line } i: \exists \text{ journal\_entry}$ and $\exists \text{ ledger\_account}$. | Foreign keys with `ON DELETE RESTRICT` and `ON UPDATE RESTRICT`. |
| **INV-05** | **Absolute Immutability** | Posted entries and lines can never be updated or deleted. | Role-level REVOKE of `UPDATE` and `DELETE`, plus explicit triggers rejecting mutation attempts. |
| **INV-06** | **Compensatory Reversals (Storno)** | $\text{Reversal}(E) = E_{\text{rev}}$ where $\forall l \in E: \text{Line}_{\text{rev}} = (\text{opposite}(\text{direction}), \text{amount})$. | Domain service issuing new offsetting journal entry referencing original ID. |
| **INV-07** | **Conservation of Value** | Total system equity and assets equal total liabilities plus net income: $\text{Assets} = \text{Liabilities} + \text{Equity}$. | Zero-sum invariant across the Chart of Accounts prevents creation of phantom money. |
| **INV-08** | **Deterministic Balance Derivation** | $\text{Balance}(A, t) \equiv \sum_{i=1}^k \text{Line}_i(A)$ for all postings up to timestamp $t$. | Materialized balance equals historical summation; verified by continuous audit workers. |
| **INV-09** | **Account Nature-Specific Availability** | Customer payment account available balance cannot be negative: $\text{available\_balance\_cents} \ge 0$. | Specific table check constraint on customer liability accounts. |
| **INV-10** | **Unique Financial Operation Posting** | An operation cannot be posted twice under the same phase. | Database unique index on `journal_entries(financial_operation_id, entry_type)`. |
| **INV-11** | **Atomic All-or-Nothing Commit** | If any invariant fails, all changes in the transaction revert. | Single serializable/repeatable-read PostgreSQL transaction envelope. |

### 3.2. Account Nature Rules (Avoiding Universal Negative Constraints)

In classical accounting, imposing a blanket `balance >= 0` check on all accounts is a fatal design flaw because debit-normal and credit-normal accounts have opposite operational polarities:

1. **Asset Accounts (Activo - Class 1000):**
   * Normal Balance: **DEBIT**.
   * Physical Interpretation: Assets (e.g. cash at commercial bank sight deposit under Apartado 4.1 T.O. PSP) increase with DEBIT and decrease with CREDIT. A bank asset cannot be negative under normal operations ($\text{Balance}_{\text{debit}} \ge 0$).
2. **Customer Liability Accounts (Pasivo - Class 2000, Sub-class 2101):**
   * Normal Balance: **CREDIT**.
   * Physical Interpretation: Customer stored value is a liability owed by the fintech to the wallet user. It increases with CREDIT and decreases with DEBIT.
   * **Protection against Overdraft:** A customer payment account in an Argentine PSPCP cannot overdraw. Therefore, we enforce:
     $$\text{available\_balance\_cents} \ge 0 \quad \text{and} \quad \text{cleared\_balance\_cents} \ge 0$$
3. **Fintech Equity & Reserve Accounts (Patrimonio Neto - Class 3000):**
   * Normal Balance: **CREDIT**.
   * Can absorb operational losses or adjustments; enforcing non-negative checks on raw balance would prevent recording cumulative deficit.
4. **Revenue Accounts (Ingresos - Class 4000):**
   * Normal Balance: **CREDIT**. Cumulative fee collections increase with credit.
5. **Expense Accounts (Egresos - Class 5000):**
   * Normal Balance: **DEBIT**. Cumulative clearing and infrastructure costs increase with debit.

**Design Rule:** The check constraint `CHECK (available_balance_cents >= 0)` is strictly bound to **customer stored value payment accounts**, preserving the natural mathematical behavior of asset, equity, revenue, and expense accounts.

---

## 4. Operation & Journal Lifecycles

### 4.1. Financial Operation State Machine

```
                      +---------------------------------------+
                      |               INITIATED               |
                      +---------------------------------------+
                                          |
                                          v
                      +---------------------------------------+
                      |     PENDING_FUNDS_RESERVATION         |
                      |  (Journal Entry 1: Available->Reserved)
                      +---------------------------------------+
                                          |
                        +-----------------+-----------------+
                        | (External Network Call)           |
                        v                                   v
+---------------------------------------+   +---------------------------------------+
|     PENDING_EXTERNAL_CONFIRMATION     |   |         IMMEDIATE_LOCAL_P2P           |
| (COELSA clearing transit window)      |   | (Internal Transfer between users)     |
+---------------------------------------+   +---------------------------------------+
        |                               |                       |
        v (External Confirmation)       v (External Rejection)  |
+-------------------+       +-----------------------+           |
|     CONFIRMED     |       |       REJECTED        |           |
| (Journal Entry 2: |       | (Compensatory Storno: |           |
|  Reserved->Bank)  |       |  Reserved->Available) |           |
+-------------------+       +-----------------------+           |
        |                                                       |
        v (Dispute / Chargeback)                                |
+-------------------+                                           v
|     REVERSED      |<------------------------------------------+
| (Offsetting Storno|
|  Journal Entry)   |
+-------------------+
```

### 4.2. Journal Entry Lifecycle: Atomic Direct Posting

In traditional ERPs, journal entries sometimes linger in a mutable `DRAFT` state before an accountant reviews them. **In high-frequency fintech platforms, draft entries in the core ledger introduce race conditions and lock contention.**

**SaintPatrickBK Architectural Decision:**  
* The application domain prepares a `JournalEntryDraft` entirely in-memory.
* The draft is submitted to the database transactional engine.
* The transactional engine validates all zero-sum and non-negative invariants.
* The entry is committed directly in status **`POSTED`**.
* **Zero draft entries exist in persistent tables.** Once a row is written to `journal_entries`, it is permanently `POSTED` and immutable.

---

## 5. Concurrency, Locking Strategy, and Double-Spending Protection

### 5.1. The Double-Spending Challenge

Consider an account with an available balance of \$10,000 ARS. Two concurrent transfer requests of \$10,000 ARS arrive at identical millisecond timestamps from two different API instances:

```
[ Thread A: Transfer $10,000 ]          [ Thread B: Transfer $10,000 ]
              |                                       |
              +--- Step 1: Read Balance ($10,000)     |
              |                                       +--- Step 1: Read Balance ($10,000)
              |                                       |
              +--- Step 2: Compute Remaining ($0)     +--- Step 2: Compute Remaining ($0)
              |                                       |
              +--- Step 3: Write Balance ($0)         +--- Step 3: Write Balance ($0)
              |                                       |
              [ LOSS: $10,000 DUPLICATED FROM FINTECH ASSETS ]
```

### 5.2. Deterministic Row Locking (`SELECT ... FOR UPDATE`)

To mathematically prevent this vulnerability:
1. **Deterministic Lexicographical Ordering:**
   * In any operation involving multiple accounts (e.g. Account A and Account B), locks on `account_balances` are acquired in strict **lexicographical ascending order of `account_id`**:
     $$\min(\text{ID}_A, \text{ID}_B) \quad \text{then} \quad \max(\text{ID}_A, \text{ID}_B)$$
   * This deterministic order prevents two concurrent cross-transfers (A $\rightarrow$ B and B $\rightarrow$ A) from creating a cyclic wait condition.
2. **Pessimistic Row Lock Execution:**
   ```sql
   SELECT available_balance_cents, cleared_balance_cents, version
   FROM account_balances
   WHERE account_id = $1
   FOR UPDATE;
   ```
3. **Execution Sequence:**
   * Thread A acquires row lock on Account A.
   * Thread B attempts to acquire row lock on Account A and is suspended by the PostgreSQL lock manager.
   * Thread A validates $\$10,000 \ge \$10,000$, reserves/debits $\$10,000$, writes journal entry and lines, updates `available_balance_cents = 0`, writes outbox event, and commits.
   * Upon commit, Thread A releases the lock.
   * Thread B wakes up, reads the *committed* state (`available_balance_cents = 0`), detects that $\$0 < \$10,000$, and fails immediately with:
     `Result.err(new InsufficientFundsError(accountId, requestedCents, availableCents))`
   * **Double-spending is rendered physically impossible.**

---

## 6. Proposed PostgreSQL 18 DDL (Unexecuted Design Blueprint)

```sql
-- =============================================================================
-- SaintPatrickBK Ledger Core DDL Specification (PostgreSQL 18)
-- STATUS: DESIGN PROPOSAL - DO NOT EXECUTE UNTIL PHASE 3 APPROVAL
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS ledger;

-- -----------------------------------------------------------------------------
-- 1. Chart of Accounts & Individual Ledger Accounts
-- -----------------------------------------------------------------------------
CREATE TYPE ledger.account_class AS ENUM (
    'ASSET',      -- 1000: Commercial bank backing deposits, clearing transits
    'LIABILITY',  -- 2000: Customer stored value, in-flight reservations
    'EQUITY',     -- 3000: Regulatory capital, statutory reserves
    'REVENUE',    -- 4000: Processing fees, interchange income
    'EXPENSE'     -- 5000: Settlement fees, banking maintenance costs
);

CREATE TYPE ledger.balance_direction AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE ledger.account_status AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');

CREATE TABLE ledger.ledger_accounts (
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
-- 2. Materialized Account Balances (Concurrency & Lock Anchor)
-- -----------------------------------------------------------------------------
CREATE TABLE ledger.account_balances (
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

-- Note: Customer accounts receive an explicit check constraint ensuring non-negative available balance:
-- ALTER TABLE ledger.account_balances ADD CONSTRAINT chk_customer_no_overdraft 
-- CHECK (account_id NOT IN (...) OR available_balance_cents >= 0);

-- -----------------------------------------------------------------------------
-- 3. Financial Business Operations
-- -----------------------------------------------------------------------------
CREATE TYPE ledger.operation_status AS ENUM (
    'INITIATED',
    'PENDING_FUNDS_RESERVATION',
    'PENDING_EXTERNAL_CONFIRMATION',
    'CONFIRMED',
    'REJECTED',
    'REVERSED'
);

CREATE TABLE ledger.financial_operations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_reference_id VARCHAR(255) NOT NULL UNIQUE,
    operation_type VARCHAR(64) NOT NULL, -- e.g. 'P2P_TRANSFER', 'CASH_IN_COELSA', 'CASH_OUT_CBU'
    status ledger.operation_status NOT NULL DEFAULT 'INITIATED',
    source_account_id UUID REFERENCES ledger.ledger_accounts(id),
    destination_account_id UUID REFERENCES ledger.ledger_accounts(id),
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency CHAR(3) NOT NULL DEFAULT 'ARS',
    reversal_of_operation_id UUID REFERENCES ledger.financial_operations(id),
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- -----------------------------------------------------------------------------
-- 4. Journal Entries (Immutable Accounting Book)
-- -----------------------------------------------------------------------------
CREATE TABLE ledger.journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id BIGSERIAL NOT NULL UNIQUE,
    financial_operation_id UUID NOT NULL REFERENCES ledger.financial_operations(id) ON DELETE RESTRICT,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    entry_type VARCHAR(64) NOT NULL, -- 'INITIAL_RESERVATION', 'SETTLEMENT', 'STORNO_REVERSAL'
    description TEXT NOT NULL,
    posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_operation_entry_type UNIQUE (financial_operation_id, entry_type)
);

-- -----------------------------------------------------------------------------
-- 5. Journal Lines (Individual Postings)
-- -----------------------------------------------------------------------------
CREATE TABLE ledger.journal_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES ledger.journal_entries(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES ledger.ledger_accounts(id) ON DELETE RESTRICT,
    entry_number INT NOT NULL CHECK (entry_number > 0),
    direction ledger.balance_direction NOT NULL,
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency CHAR(3) NOT NULL DEFAULT 'ARS',
    CONSTRAINT uq_entry_line_number UNIQUE (journal_entry_id, entry_number)
);

CREATE INDEX idx_journal_lines_account_lookup 
ON ledger.journal_lines(account_id, journal_entry_id);

-- -----------------------------------------------------------------------------
-- 6. Transactional Outbox (Guaranteed At-Least-Once Delivery)
-- -----------------------------------------------------------------------------
CREATE TYPE ledger.outbox_status AS ENUM ('PENDING', 'DISPATCHED', 'FAILED');

CREATE TABLE ledger.outbox_events (
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

CREATE INDEX idx_outbox_pending_events 
ON ledger.outbox_events(status, created_at) 
WHERE status = 'PENDING';

-- -----------------------------------------------------------------------------
-- 7. Zero-Sum Balance Deferred Constraint Function
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.fn_enforce_zero_sum_balance()
RETURNS TRIGGER AS $$
DECLARE
    v_net_balance BIGINT;
    v_line_count INT;
    v_entry_id UUID;
BEGIN
    v_entry_id := COALESCE(NEW.journal_entry_id, OLD.journal_entry_id);

    -- Calculate total lines and net sum (DEBIT = +amount, CREDIT = -amount)
    SELECT 
        COUNT(*),
        COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE -amount_cents END), 0)
    INTO v_line_count, v_net_balance
    FROM ledger.journal_lines
    WHERE journal_entry_id = v_entry_id;

    -- Invariant 1: At least 2 lines required
    IF v_line_count < 2 THEN
        RAISE EXCEPTION 'INV-01 VIOLATION: Journal Entry % has only % line(s). Minimum 2 required.',
            v_entry_id, v_line_count
            USING ERRCODE = '23514'; -- check_violation
    END IF;

    -- Invariant 2: Net balance must equal zero
    IF v_net_balance <> 0 THEN
        RAISE EXCEPTION 'INV-02 VIOLATION: Journal Entry % is unbalanced. Net delta: % centavos.',
            v_entry_id, v_net_balance
            USING ERRCODE = '23514'; -- check_violation
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DEFERRED Constraint Trigger: Evaluated at transaction COMMIT
CREATE CONSTRAINT TRIGGER trg_verify_journal_balance
AFTER INSERT OR UPDATE OR DELETE ON ledger.journal_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION ledger.fn_enforce_zero_sum_balance();

-- -----------------------------------------------------------------------------
-- 8. Explicit Immutability Triggers (Zero Silent Rules)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger.fn_prevent_journal_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'INV-05 VIOLATION: Posted journal entries and postings are immutable. Updates and deletions are strictly prohibited.'
        USING ERRCODE = '23505'; -- restrictive error code
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_prevent_journal_entries_mutation
BEFORE UPDATE OR DELETE ON ledger.journal_entries
FOR EACH ROW EXECUTE FUNCTION ledger.fn_prevent_journal_mutation();

CREATE TRIGGER trg_prevent_journal_lines_mutation
BEFORE UPDATE OR DELETE ON ledger.journal_lines
FOR EACH ROW EXECUTE FUNCTION ledger.fn_prevent_journal_mutation();
```

---

## 7. Role-Based Database Security & Privilege Separation

To prevent privilege escalation and accidental direct tampering with financial records:

```
+---------------------------------------------------------------------------------------+
| Database Role      | Granted Privileges                                               |
+--------------------+------------------------------------------------------------------+
| `spbk_admin`       | Superuser (Local dev / DB setup only). Full DDL & maintenance.   |
| `spbk_migrator`    | DDL on `ledger.*` schemas (Executed exclusively during CI/CD).   |
| `spbk_app`         | Runtime least-privilege:                                         |
|                    | * SELECT on all ledger tables.                                   |
|                    | * INSERT on `journal_entries`, `journal_lines`, `outbox_events`. |
|                    | * UPDATE exclusively on `account_balances` and `financial_ops`.  |
|                    | * REVOKE DELETE on all financial tables.                         |
|                    | * REVOKE UPDATE on `journal_entries` and `journal_lines`.        |
+--------------------+------------------------------------------------------------------+
```

---

## 8. Monetary Representation, Scaling, and Multi-Currency Model

### 8.1. Representation Specification
* **Canonical Minor Unit:** All monetary amounts are represented as **64-bit Signed Integers** (`BIGINT` in PostgreSQL, `bigint` in TypeScript).
* **Currency Code:** ISO 4217 standard 3-character string (`ARS`).
* **Scaling Ratio:** $1.00 \text{ ARS} = 100 \text{ centavos}$.
* **Maximum Theoretical Representation:**
  $$2^{63} - 1 = 9,223,372,036,854,775,807 \text{ centavos} \approx \$92.2 \text{ quadrillion ARS}$$
* **Operational Maximum Single Transaction Cap:**
  $$\$100,000,000.00 \text{ ARS} = 10,000,000,000 \text{ centavos}$$
  Any single transfer exceeding this threshold is rejected by application domain guards.

### 8.2. External API Serializer Contract
To prevent silent precision truncation in client environments (JavaScript/JSON loses precision beyond $2^{53} - 1 = 9,007,199,254,740,991$):
* **Request Payload Contract:**
  ```json
  {
    "amount_cents": "500000",
    "currency": "ARS"
  }
  ```
* **Validation:** Zod schemas enforce regex `/^\d+$/` before passing values to `Money.fromApiString()`. Floating-point numbers (`5000.00`) are rejected at the API ingress gateway.

---

## 9. Comprehensive Testing Matrix & Failure Scenarios

| Test Category | Scenario / Invariant Tested | Test Mechanism | Expected Outcome |
| :--- | :--- | :--- | :--- |
| **Balanced Posting** | 2-line balanced transfer ($+1000, -1000$) | Unit & Integration | Transaction commits cleanly; balances update. |
| **Unbalanced Rejection** | Attempting to commit $+1000$ vs $-999$ | Real PostgreSQL 18 | `trg_verify_journal_balance` raises `INV-02 VIOLATION`; entire transaction aborts. |
| **Single-Line Rejection** | Attempting to insert a 1-line journal entry | Real PostgreSQL 18 | `INV-01 VIOLATION` raised; rollback verified. |
| **Zero/Negative Amount** | Line with `amount_cents = 0` or `-500` | Real PostgreSQL 18 | `chk_positive_amount` check constraint failure; rollback. |
| **Immutability Breach** | Executing `UPDATE ledger.journal_lines` | Real PostgreSQL 18 | `trg_prevent_journal_lines_mutation` raises exception; zero rows modified. |
| **Double-Spending Race** | 50 concurrent threads spending single \$10,000 balance | Testcontainers multi-worker | Deterministic row locks ensure **exactly 1 succeeds**; 49 fail with `INSUFFICIENT_FUNDS`. Available balance strictly 0. |
| **Cyclic Cross-Transfer** | Thread 1: A $\rightarrow$ B; Thread 2: B $\rightarrow$ A | Testcontainers concurrency | Deterministic lock ordering ($\min(A,B) \rightarrow \max(A,B)$) prevents deadlocks completely. |
| **Transient Lock Failure** | Inducing `40P01` or `40001` error | Integration simulation | Application retry interceptor retries with exponential backoff and succeeds on retry. |
| **Snapshot Reconstruction** | Rebuilding balance from 10,000 randomized operations | Fast-check property test | $\sum \text{journal\_lines} \equiv \text{account\_balances.cleared\_balance\_cents}$. Net diff = 0. |

---

## 10. Technical Risks & Pending Decisions

1. **Transaction Isolation Level Selection:**
   * `READ COMMITTED` with pessimistic row locking (`FOR UPDATE`) provides excellent throughput and prevents double-spending, but requires strict lexicographical lock sorting.
   * `SERIALIZABLE` isolation eliminates non-serializable interleavings automatically, but incurs transaction aborts requiring application-level retries under high contention.
   * *Scheduled Decision:* Benchmark both isolation levels under simulated 1,000 req/sec load in Phase 3.
2. **Materialized Balance Partitioning Strategy:**
   * At high scale ($> 100\text{M}$ entries), `journal_lines` should be range-partitioned by `journal_entry.posted_at` (monthly partitions). To be introduced once operational volume warrants it.
3. **Dual-Approval (Maker-Checker) for Manual Stornos:**
   * Automatic stornos for rejected external clearing execute programmatically. Manual dispute corrections must require two independent operator signatures in the backoffice.
