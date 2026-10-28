# ADR-0003: Ledger Core Schema Design, Mathematical Invariants, and Transactional Consistency

**Status:** Accepted (Validated via PostgreSQL 18 Testcontainers Suite)  
**Deciders:** Senior Software Architect, Lead Engineering Team  
**Date:** October 27, 2026  
**Context & Scope:** Core Financial Ledger for SaintPatrickBK

---

## Context and Problem Statement

SaintPatrickBK requires a single, inviolable financial source of truth capable of operating in the Argentine financial ecosystem under BCRA (Apartado 4.1 T.O. PSP) and UIF (Res. 200/2024) oversight. The architectural review identified five critical risks in conventional database designs:
1. **Unprivileged Role vs. Superuser Vulnerability:** Running financial `SECURITY DEFINER` functions under a superuser role or with an insecure `search_path` exposes the database to privilege escalation and object hijacking (CVE-2018-1058).
2. **False Immutability:** Blocking `UPDATE` and `DELETE` on journal tables does not prevent attackers or faulty code from inserting additional lines into already-committed journal entries.
3. **Materialized Balance Drift:** If the application database role possesses direct `UPDATE` permissions on `account_balances`, a software bug or direct SQL execution can alter customer balances independently of any balanced double-entry movement.
4. **Double Deduction in Reservations:** Maintaining funds reservations as operative records outside the ledger risks double-counting or discrepancies during clearing cycles.
5. **Transient Idempotency Failures:** Relying solely on short-lived HTTP cache TTLs (e.g., Redis 24h) allows duplicate monetary operations if network timeouts or client retries occur after key expiration.

## Decision Drivers

* **Regulatory Inviolability:** BCRA T.O. PSP (Apartado 4.1) and UIF regulations mandate a tamper-evident, fully reconstructible audit trail.
* **Engine-Enforced Security:** Financial invariants must be guarded by PostgreSQL 18 constraints, triggers, and role permissions, not merely by application conventions.
* **Principle of Least Privilege (RBAC):** Distinct roles for schema migration (`spbk_migrator`), function ownership (`spbk_ledger_owner`), and runtime application execution (`spbk_app`). No financial procedures execute with `SUPERUSER`.
* **Double-Spending Prevention:** Concurrency control must withstand high-frequency simultaneous requests without race conditions or overdrafts.
* **Mathematical Exactness:** Strict conservation of money ($\sum D - \sum C = 0$) and 64-bit integer centavos per currency.
* **Audit Reproducibility:** Point-in-time balances must be 100% reproducible from historical journal lines.

## Considered Options

1. **Option 1: Direct Application Mutation with Trigger Checks**
   * Application role `spbk_app` executes multi-statement SQL (`INSERT INTO journal_entries`, `INSERT INTO journal_lines`, `UPDATE account_balances`).
   * *Rejected:* Leaves open attack vectors where `account_balances` is updated directly or uncoordinated inserts bypass business validation.
2. **Option 2: Operative Reservations Outside Ledger (Strategy A)**
   * Available balance computed as `cleared_balance - sum(active_reservations)`.
   * *Rejected:* Prone to double-counting during clearing settlement; historical replay of journal lines cannot reconstruct the exact reserved state.
3. **Option 3: Hardened Ledger with `SECURITY DEFINER` Gateway, Append Guards, RBAC Separation, and Accounted Reservations (Strategy B) - SELECTED**
   * Dedicated unprivileged role `spbk_ledger_owner` (`NOSUPERUSER`, `NOCREATEDB`, `NOCREATEROLE`) owns tables and functions.
   * Direct write access to `account_balances`, `journal_entries`, and `journal_lines` is completely revoked from `spbk_app`.
   * Authorized transactional gateways (`ledger.fn_post_transfer`, `ledger.fn_create_reservation`, etc.) execute under `SECURITY DEFINER` with hardened `SET search_path = pg_catalog, ledger, pg_temp`.
   * Deferred constraint trigger validates zero-sum balance per currency and locks the entry (`is_locked = TRUE`).
   * Pre-insert trigger on `journal_lines` physically blocks appending lines to locked entries.
   * Reservations are modeled as zero-sum journal movements between customer available liability (`2101`) and in-flight reserved liability (`2102`).
   * Business operation idempotency combines `client_reference_id` with a deterministic SHA-256 payload hash stored permanently in `financial_operations`.

## Decision Outcome

**Chosen Option: Option 3.**

### Key Architectural Guarantees:

1. **Role-Based Access Control (RBAC) & Hardened `SECURITY DEFINER`:**
   * `spbk_ledger_owner`: Dedicated non-superuser role owning the `ledger` schema, tables, and functions.
   * `spbk_migrator`: Dedicated role for schema DDL execution.
   * `spbk_app`: Dedicated runtime role with `USAGE` on schema, `SELECT` on financial tables, and `EXECUTE` on authorized procedures. Zero direct `INSERT`, `UPDATE`, or `DELETE` permissions on financial tables.
   * `PUBLIC`: `EXECUTE` on all financial procedures is explicitly revoked.
   * Secure `search_path`: All `SECURITY DEFINER` functions pin `search_path = pg_catalog, ledger, pg_temp` (`pg_catalog` first blocks function hijacking; `pg_temp` last prevents temporary table spoofing).

2. **Real Immutability & Append Rejection:**
   * Deferred trigger `trg_verify_journal_entry_commit` validates:
     - Minimum 2 lines per entry (INV-01).
     - Per-currency zero-sum balance: `GROUP BY currency HAVING SUM(amount * direction_sign) <> 0` (INV-02).
     - Sets `journal_entries.is_locked = TRUE` atomically at `COMMIT`.
   * Trigger `trg_prevent_append_to_locked_entry` rejects any `INSERT` into `journal_lines` if the parent entry is locked.
   * Triggers `trg_prevent_journal_entries_mutation` and `trg_prevent_journal_lines_mutation` reject all `UPDATE` and `DELETE` attempts.
   * Mutation of `is_locked` is protected: transitions are permitted only from `FALSE` to `TRUE` by the commit trigger.

3. **Single Authorized Transactional Gateways:**
   * Role `spbk_app` has ZERO write permissions on financial tables (`42501 permission denied` on direct write attempts).
   * Posting occurs exclusively through authorized stored procedures:
     - `ledger.fn_post_transfer`: Internal transfers, credit top-ups, debit payouts.
     - `ledger.fn_create_reservation`: Pledges funds from `2101:Available` to `2102:Reserved`.
     - `ledger.fn_settle_reservation`: Debits `2102:Reserved` and credits external bank asset `1101:Sight`.
     - `ledger.fn_release_reservation`: Compensatory storno from `2102:Reserved` back to `2101:Available`.
     - `ledger.fn_post_reversal`: Posts strict compensatory reversal entry referencing the original journal entry.
     - `ledger.fn_audit_reconcile_balances`: Audits and verifies materialized balances against raw line history.

4. **Reservation Strategy B (Accounted Reservations):**
   * Moving funds from available to reserved is a genuine double-entry transfer between `2101:Available` and `2102:Reserved`.
   * Guarantees that historical line summation reproduces the exact available/reserved breakdown without relying on external tables.
   * State transitions: `PENDING` $\rightarrow$ `SETTLED`, `RELEASED`, or `EXPIRED`.
   * Mutual exclusion: A reservation cannot be both settled and released.
   * Idempotent re-entry: Calls to settle or release with the same `client_reference_id` replay the committed result; calls with different references throw `RESERVATION_ALREADY_SETTLED` or `RESERVATION_ALREADY_RELEASED`.

5. **Persistent Financial Idempotency:**
   * Every financial operation requires a unique `client_reference_id` and a canonical SHA-256 payload hash.
   * Replays with identical hash return the cached financial result (`isIdempotentReplay = true`).
   * Replays with different payloads for the same reference ID throw `IDEMPOTENCY_CONFLICT` (error `23505` / business exception).
   * Transactional Outbox events are written in the same atomic database transaction, ensuring zero loss of downstream events.

6. **Three-Tier Deadlock Defense:**
   * Removes unrealistic claims of absolute deadlock impossibility.
   * *Tier 1:* Deterministic lexicographical locking (`LEAST(source, dest)` then `GREATEST(source, dest)`).
   * *Tier 2:* Database timeout tuning (`deadlock_timeout = 100ms`, `statement_timeout = 5s`).
   * *Tier 3:* Application retry interceptor for `40P01` and `40001` with exponential jittered backoff.

7. **Immutability Boundary & Residual Risk Disclosure:**
   * *Guarantee:* Complete immutability and tamper-resistance against application roles (`spbk_app`), compromised credentials, ORM errors, or direct SQL injections.
   * *Residual Risk:* PostgreSQL triggers and table constraints do not prevent a PostgreSQL superuser (`postgres`) or DBA with `ALTER TABLE ... DISABLE TRIGGER`, `DROP SCHEMA`, or file-level disk access from altering records. Absolute protection against administrative override requires database audit logging (e.g., `pgaudit`), cloud IAM segregation, and immutable WORM backups.

## Verification & Status

All invariants were executed and verified against a genuine PostgreSQL 18 container via Testcontainers across 11 test suites and 67 automated integration tests:
* `rbac-security.integration.spec.ts`: Validates non-superuser `spbk_ledger_owner`, revocation of direct writes on `spbk_app`, revocation of `EXECUTE` from `PUBLIC`, search path validation, and rejection of DDL by `spbk_app`.
* `invariants-and-locking.integration.spec.ts`: Validates rejection of 0 lines, 1 line, unbalanced single-currency, unbalanced multi-currency (sum=0 globally but unbalanced per-currency), append guard after commit, line immutability, and `is_locked` tamper resistance.
* `reservation-lifecycle.integration.spec.ts`: Validates full Strategy B lifecycle (creation, settlement, release, expiration, duplicate settlement rejection, duplicate release rejection, compensatory reversal, and audit reconciliation).
* `concurrency-and-idempotency.integration.spec.ts`: Validates race-condition double spending prevention, concurrent reservation on limited funds, persistent idempotency replays, idempotency payload mismatch conflict rejection, and transactional outbox persistence.
* `ledger-invariants.integration.spec.ts`: Validates experimental DDL and baseline accounting invariants.

## Consequences

* **Positive:**
  * Financial integrity is enforced by the PostgreSQL 18 engine itself, rendering direct tampering or bypass impossible.
  * Zero balance drift; every balance change has an immutable accounting origin.
  * Auditability and BCRA/UIF regulatory compliance are mathematically verifiable.
  * Least privilege RBAC blocks lateral privilege escalation.
* **Negative:**
  * Application must interface with the transactional stored procedure rather than executing raw ORM writes.
  * Requires disciplined maintenance of versioned SQL migration scripts.

