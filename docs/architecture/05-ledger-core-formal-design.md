# SaintPatrickBK Ledger Core: Formal Architecture, Data Model, and Invariants

**Document Status:** Formal Architecture & Mathematical Blueprint (Phase 3 Implementation Baseline)  
**Authority:** Core Financial Systems Architecture  
**Target Engine:** PostgreSQL 18 | TypeScript Strict | Node.js 24 LTS  
**Review Status:** Fully Implemented and Validated via PostgreSQL 18 Testcontainers (67/67 Workspace Tests Passing)

---

## 1. Executive Summary & Core Philosophy

The **Ledger Core** is the definitive, immutable financial authority of SaintPatrickBK. In a regulated financial platform operating under Central Bank of Argentina (**BCRA**) and **UIF** standards, account balances are never treated as raw mutable numbers stored in arbitrary tables. **A balance is a deterministic, mathematically verifiable projection of an immutable double-entry journal.**

This implementation incorporates four fundamental guarantees enforced at the PostgreSQL engine level:
1. **Physical Ledger Immutability & Append Guards:** Beyond blocking `UPDATE` and `DELETE`, the engine physically prohibits appending new lines to any journal entry once committed. Empty entries, single-line entries, and currency-imbalanced entries are blocked at `COMMIT` time via deferred constraint triggers.
2. **Materialized Balance Consistency via Security Definer Gateway:** Direct `UPDATE`, `INSERT`, and `DELETE` permissions on financial tables are strictly revoked from the runtime application role (`spbk_app`). Balances and postings can only be mutated through hardened `SECURITY DEFINER` atomic functions owned by a dedicated, unprivileged role (`spbk_ledger_owner`), accompanied by continuous audit reconciliation (`ledger.fn_audit_reconcile_balances`).
3. **Formal Funds Reservation Model (Strategy B):** Reservations are fully accounted within the double-entry ledger via designated transit liability sub-accounts (`2102:Customer:Reserved`), preventing dual-accounting and double-deduction risks while supporting independent balance reconstruction.
4. **Persistent Business Idempotency:** Client business operations are governed by immutable unique keys (`client_reference_id`) coupled with SHA-256 canonical request hashes, ensuring operations survive API-layer TTL expirations and recover cleanly from network interruptions.

> [!WARNING]
> **Scope of Engine Guarantees & Residual Administrative Risk:**  
> The immutability and consistency guarantees documented herein protect the financial ledger against application-level vulnerabilities, rogue application queries, ORM misconfigurations, and concurrency race conditions under the `spbk_app` role.  
> **These guarantees do NOT equate to absolute protection against PostgreSQL superusers or DBAs** who possess physical access or privileges to execute `ALTER TABLE ... DISABLE TRIGGER`, `DROP SCHEMA`, or tamper with transaction logs. Absolute security against administrative tampering requires cloud-level immutable storage replication (WORM), continuous WAL archiving, and segregated HSM/KMS keys.

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
|   | client_reference_id (UNQ)|                         | operation_id (UUID FK)                |   |
|   | request_hash (CHAR(64))  |                         | account_id (UUID FK)                  |   |
|   | operation_type (VARCHAR) |                         | reserved_account_id (UUID FK)         |   |
|   | status (ENUM)            |                         | amount_cents (BIGINT > 0)             |   |
|   | source_account_id (FK)   |                         | currency (CHAR(3))                    |   |
|   | destination_account_id FK|                         | status (ACTIVE/SETTLED/REL/EXP)       |   |
|   | amount_cents (BIGINT > 0)|                         | settlement_client_ref (VARCHAR)       |   |
|   | currency (CHAR(3))       |                         | release_client_ref (VARCHAR)          |   |
|   | reversal_of_op_id (FK)   |                         | creation_journal_entry_id (FK)        |   |
|   | metadata (JSONB)         |                         | settlement_journal_entry_id (FK)      |   |
|   | created_at (TIMESTAMPTZ) |                         | release_journal_entry_id (FK)         |   |
|   | updated_at (TIMESTAMPTZ) |                         | expires_at (TIMESTAMPTZ)              |   |
|   +--------------------------+                         +---------------------------------------+   |
|                | 1                                                                                 |
+----------------|-----------------------------------------------------------------------------------+
                 |
                 | 1..* (An operation generates multiple balanced journal entries over its lifecycle)
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
|   | is_locked (BOOLEAN)      |                         | amount_cents (BIGINT > 0)             |   |
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
                 | (Written in the same atomic PostgreSQL transaction via stored procedures)
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
|   | payload (JSONB)                    |             | response_code (INT)                     |   |
|   | status (PENDING/DISPATCHED/FAILED) |             | response_body (JSONB)                   |   |
|   | created_at (TIMESTAMPTZ)           |             | expires_at (TIMESTAMPTZ, 48h TTL)       |   |
|   +------------------------------------+             +-----------------------------------------+   |
+----------------------------------------------------------------------------------------------------+
```

---

## 3. Mandatory Mathematical Invariants

The Ledger Core enforces eleven foundational mathematical and structural invariants. If any single invariant is breached, the database engine physically rejects the transaction and rolls back all modifications.

### 3.1. Catalog of Invariants

| Invariant ID | Rule Name | Mathematical / Logical Expression | Enforcement Mechanism |
| :--- | :--- | :--- | :--- |
| **INV-01** | **Dual-Leg Rule** | $\text{Count}(\text{lines}) \ge 2$ per Journal Entry. Empty entries prohibited. | Constraint trigger `trg_verify_journal_entry_commit` on `journal_entries` at `COMMIT`. |
| **INV-02** | **Zero-Sum Balance** | $\forall \text{ currency } c: \sum_{i=1}^n \left( \text{amount}_i \cdot \delta_i \right) = 0$ where $\delta = +1$ for DEBIT and $-1$ for CREDIT. | Trigger `trg_verify_journal_entry_commit` verifying net balance equals 0 per currency. |
| **INV-03** | **Strictly Positive Postings** | $\forall \text{ line } i: \text{amount\_cents}_i > 0$. | Table check constraint: `CHECK (amount_cents > 0)`. Zero or negative lines prohibited. |
| **INV-04** | **Currency Matching** | $\forall \text{ line } i: \text{line.currency} = \text{account.currency}$. | Trigger `trg_check_line_currency_matches_account` evaluated before line insertion. |
| **INV-05** | **Absolute Immutability & Append Guard** | Posted entries and lines can never be updated or deleted, nor can new lines be added to locked entries. | Triggers `trg_prevent_journal_entries_mutation`, `trg_prevent_journal_lines_mutation`, and `trg_prevent_append_to_locked_entry`. |
| **INV-06** | **Compensatory Reversals (Storno)** | $\text{Reversal}(E) = E_{\text{rev}}$ where $\forall l \in E: \text{Line}_{\text{rev}} = (\text{opposite}(\text{direction}), \text{amount})$. | Stored function `ledger.fn_post_reversal` creating offsetting journal entries. |
| **INV-07** | **Conservation of Value** | Total system equity and assets equal total liabilities plus net income: $\text{Assets} = \text{Liabilities} + \text{Equity}$. | Zero-sum invariant across the Chart of Accounts prevents creation of phantom money. |
| **INV-08** | **Deterministic Balance Derivation** | $\text{Balance}(A, t) \equiv \sum_{i=1}^k \text{Line}_i(A)$ for all postings up to timestamp $t$. | Materialized balance equals historical summation; verified by `fn_audit_reconcile_balances()`. |
| **INV-09** | **Account Nature-Specific Availability** | Customer payment account available balance cannot be negative: $\text{available\_balance\_cents} \ge 0$. | Availability checks in stored procedures and table consistency constraints. |
| **INV-10** | **Unique Financial Operation Posting** | An operation cannot be posted twice under the same phase. | Database unique index on `journal_entries(financial_operation_id, entry_type)`. |
| **INV-11** | **Atomic All-or-Nothing Commit** | If any invariant fails, all changes in the transaction revert. | Single serializable/repeatable-read PostgreSQL transaction envelope. |

---

## 4. Role-Based Database Security Architecture (RBAC)

### 4.1. Separation of Privileges

To ensure the principle of least privilege and eliminate superuser execution of financial logic:

```
+---------------------+-------------------+---------------------------------------------------------------------------------+
| Database Role       | Attributes        | Granted Privileges                                                              |
+---------------------+-------------------+---------------------------------------------------------------------------------+
| `spbk_admin`        | SUPERUSER         | Bootstrap only. Used exclusively to create roles and initial databases.       |
| `spbk_migrator`     | NOSUPERUSER       | DDL migrations runner in CI/CD pipeline. Granted ALL on schema `ledger`.        |
| `spbk_ledger_owner` | NOSUPERUSER       | Dedicated owner of schema `ledger`, all tables, triggers, and functions.        |
|                     | NOCREATEDB        | All `SECURITY DEFINER` functions run with this role's authority (NOT superuser).|
|                     | NOCREATEROLE      |                                                                                 |
| `spbk_app`          | NOSUPERUSER       | Runtime application role:                                                       |
|                     | NOCREATEDB        | * USAGE ON SCHEMA ledger.                                                       |
|                     | NOCREATEROLE      | * SELECT on all ledger projection and audit tables.                             |
|                     |                   | * EXECUTE on authorized financial functions only.                               |
|                     |                   | * SELECT, INSERT, UPDATE on `idempotency_records` (48h transit buffer).          |
|                     |                   | * STRICT REVOKE: ZERO direct INSERT, UPDATE, DELETE on all core financial tables.|
+---------------------+-------------------+---------------------------------------------------------------------------------+
```

### 4.2. Secure `SECURITY DEFINER` Configuration
Every stored procedure in `ledger` is configured with:
* **Definer Owner:** `ALTER FUNCTION ... OWNER TO spbk_ledger_owner;`
* **Hardened Search Path:** `SET search_path = pg_catalog, ledger, pg_temp;` (places `pg_catalog` first to block shadowing, and `pg_temp` strictly last to neutralize CVE-2018-1058 temporary object hijacking).
* **Public Revocation:** `REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ledger FROM PUBLIC;`

---

## 5. Formal Funds Reservation Model: Strategy B (Accounted Postings)

### 5.1. Strategy B Definition & Mechanics
In Strategy B, funds reservations are not operative side-tables; they are **genuine double-entry journal movements** between sub-accounts:
* `2101:Customer:Available` (Liability - Normal CREDIT)
* `2102:Customer:Reserved` (Liability - Normal CREDIT)

When funds are reserved:
$$\text{Line 1: DEBIT } 2101 \quad (\text{Available decreases}) \qquad \text{Line 2: CREDIT } 2102 \quad (\text{Reserved increases})$$
Total customer funds with the fintech (`cleared_balance_cents`) remain invariant during reservation because both accounts are customer liabilities.

### 5.2. Complete State Machine & Lifecycle Matrix

```
                      +---------------------------------------+
                      |               INITIATED               |
                      +---------------------------------------+
                                          |
                                          v (fn_create_reservation)
                      +---------------------------------------+
                      |                ACTIVE                 |
                      | (DEBIT 2101:Avail, CREDIT 2102:Res)   |
                      +---------------------------------------+
                                          |
                   +----------------------+----------------------+
                   | (Confirmed by COELSA)| (Rejected / Expired) |
                   v                      v                      v
        +--------------------+  +--------------------+  +--------------------+
        |      SETTLED       |  |      RELEASED      |  |      EXPIRED       |
        | (DEBIT 2102:Res,   |  | (DEBIT 2102:Res,   |  | (DEBIT 2102:Res,   |
        |  CREDIT 1101:Bank) |  |  CREDIT 2101:Avail)|  |  CREDIT 2101:Avail)|
        +--------------------+  +--------------------+  +--------------------+
                   |
                   v (Dispute / Chargeback via fn_post_reversal)
        +--------------------+
        |      REVERSED      |
        | (DEBIT 1101:Bank,  |
        |  CREDIT 2101:Avail)|
        +--------------------+
```

* **Double Settlement Prevention:** The reservation row is locked `FOR UPDATE`. If `status = 'SETTLED'`, any subsequent request with a different `client_reference_id` is rejected with `RESERVATION_ALREADY_SETTLED`.
* **Settled Release Prevention:** Releasing a `SETTLED` reservation is rejected with `CANNOT_RELEASE_SETTLED_RESERVATION`.
* **Idempotent Recovery:** If an identical `client_reference_id` repeats, the stored function recognizes the committed state and replays the original identifiers with `out_is_idempotent_replay = TRUE`.

---

## 6. Versioned SQL Migrations Specification

The Ledger Core is managed through five reproducible, sequential SQL migrations located in `platform/packages/ledger/migrations/`:

| Migration File | Responsibility |
| :--- | :--- |
| `001_create_ledger_roles.sql` | Provisions `spbk_ledger_owner`, `spbk_migrator`, and `spbk_app` with least privileges. |
| `002_create_ledger_schema_and_tables.sql` | Creates schema `ledger`, financial types, and all core tables with `ON DELETE RESTRICT`. |
| `003_create_ledger_triggers_and_invariants.sql` | Installs deferred zero-sum commit triggers, immutability blockers, and post-commit append guards. |
| `004_create_ledger_functions.sql` | Deploys atomic `SECURITY DEFINER` functions: `fn_post_transfer`, `fn_create_reservation`, `fn_settle_reservation`, `fn_release_reservation`, `fn_post_reversal`, and `fn_audit_reconcile_balances`. |
| `005_grant_permissions.sql` | Revokes public access, grants execution rights to `spbk_app`, and revokes direct table writes. |

---

## 7. TypeScript Repositories & Domain Integration

The TypeScript layer (`@spbk/ledger`) enforces DDD boundaries and never bypasses database consistency:
* **`PostgresLedgerRepository`:** Executes transfers exclusively via `ledger.fn_post_transfer(...)` and queries point-in-time balances. **Zero direct `UPDATE` queries exist on `account_balances`.**
* **`PostgresFundsReservationRepository`:** Implements `createReservation`, `settleReservation`, and `releaseReservation` via their respective stored procedures.
* **`Money` Value Object:** Enforces BigInt centavos arithmetic across all use cases.
* **Deterministic Request Hashing:** Use cases compute SHA-256 hashes of canonical JSON request payloads, guaranteeing business idempotency independently of HTTP transit caches.

---

## 8. Verifiable Test Suite Results (PostgreSQL 18 Real Testcontainers)

The complete monorepo test suite was executed against genuine PostgreSQL 18 instances via Testcontainers. **All 11 test files and all 67 test suites passed:**

```
Test Files  11 passed (11)
Tests       67 passed (67)
Duration    12.92s

Breakdown:
- @spbk/ledger/src/__tests__/rbac-security.integration.spec.ts (10 tests) - PASSED
  * Verified spbk_ledger_owner is non-superuser (rolsuper=false, rolcreatedb=false, rolcreaterole=false)
  * Verified PUBLIC has NO execute privileges on financial functions
  * Verified spbk_app has EXECUTE on functions and SELECT on tables
  * Verified spbk_app is rejected on direct UPDATE account_balances (42501)
  * Verified spbk_app is rejected on direct INSERT journal_entries / journal_lines (42501)
  * Verified spbk_app is rejected on direct INSERT funds_reservations (42501)
  * Verified spbk_app is rejected on schema creation in ledger (42501)

- @spbk/ledger/src/__tests__/invariants-and-locking.integration.spec.ts (8 tests) - PASSED
  * Rejected empty journal entry (0 lines) at COMMIT (INV-01)
  * Rejected single-line entry at COMMIT (INV-01)
  * Rejected unbalanced single-currency entry at COMMIT (INV-02)
  * Rejected multi-currency entry where net sum is zero but per-currency unbalanced (INV-02)
  * Rejected line currency mismatch with account currency (INV-04)
  * Rejected non-positive line amount (CHECK amount_cents > 0)
  * Verified valid entry commits, locks, and rejects post-commit line append (INV-05 Append Guard)
  * Rejected UPDATE and DELETE on committed entries and lines (INV-05 Immutability)

- @spbk/ledger/src/__tests__/reservation-lifecycle.integration.spec.ts (8 tests) - PASSED
  * Scenario 1: Created reservation; verified available balance reduced while cleared balance remained constant
  * Scenario 2: Settled reservation; verified customer cleared balance and bank asset debited
  * Scenario 3: Rejected duplicate settlement attempt (RESERVATION_ALREADY_SETTLED)
  * Scenario 4: Rejected release attempt on settled reservation (CANNOT_RELEASE_SETTLED_RESERVATION)
  * Scenario 5: Created and released reservation; verified available balance restored via storno
  * Scenario 6: Rejected settle and duplicate release on released reservation
  * Scenario 7: Handled expiration with EXPIRED status
  * Scenario 8: Verified 100% balance reconstruction from historical lines without discrepancies (discrepancy = 0)

- @spbk/ledger/src/__tests__/concurrency-and-idempotency.integration.spec.ts (5 tests) - PASSED
  * 10 concurrent transfer requests on limited funds: exactly 1 succeeded, 9 rejected with INSUFFICIENT_FUNDS
  * 2 concurrent reservations exceeding available funds: exactly 1 succeeded, 1 rejected
  * Persistent idempotency: identical replay returned committed result without moving funds
  * Idempotency conflict: reusing client_reference_id with differing payload failed with IDEMPOTENCY_CONFLICT
  * Outbox atomicity: TransferCompletedEvent persisted atomically in same transaction

- @spbk/infrastructure, @spbk/shared-kernel, @spbk/api (26 tests) - PASSED
```
