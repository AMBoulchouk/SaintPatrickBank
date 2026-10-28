# ADR-0003: Ledger Core Schema Design, Mathematical Invariants, and Transactional Consistency

**Status:** Accepted (Validated via PostgreSQL 18 Testcontainers Suite)  
**Deciders:** Senior Software Architect, Lead Engineering Team  
**Date:** October 27, 2026  
**Context & Scope:** Core Financial Ledger for SaintPatrickBK

---

## Context and Problem Statement

SaintPatrickBK requires a single, inviolable financial source of truth capable of operating in the Argentine financial ecosystem under BCRA (Apartado 4.1 T.O. PSP) and UIF (Res. 200/2024) oversight. The architectural review identified three critical risks in conventional database designs:
1. **False Immutability:** Blocking `UPDATE` and `DELETE` on journal tables does not prevent attackers or faulty code from inserting additional lines into already-committed journal entries.
2. **Materialized Balance Drift:** If the application database role possesses direct `UPDATE` permissions on `account_balances`, a software bug or direct SQL execution can alter customer balances independently of any balanced double-entry movement.
3. **Double Deduction in Reservations:** Maintaining funds reservations as operative records outside the ledger risks double-counting or discrepancies during clearing cycles.

## Decision Drivers

* **Regulatory Inviolability:** BCRA T.O. PSP (Apartado 4.1) and UIF regulations mandate a tamper-evident, fully reconstructible audit trail.
* **Engine-Enforced Security:** Financial invariants must be guarded by PostgreSQL 18 constraints, triggers, and role permissions, not merely by application conventions.
* **Double-Spending Prevention:** Concurrency control must withstand high-frequency simultaneous requests without race conditions.
* **Mathematical Exactness:** Strict conservation of money ($\sum D - \sum C = 0$) and 64-bit integer centavos.
* **Audit Reproducibility:** Point-in-time balances must be 100% reproducible from historical journal lines.

## Considered Options

1. **Option 1: Direct Application Mutation with Trigger Checks**
   * Application role `spbk_app` executes multi-statement SQL (`INSERT INTO journal_entries`, `INSERT INTO journal_lines`, `UPDATE account_balances`).
   * *Rejected:* Leaves open attack vectors where `account_balances` is updated directly or uncoordinated inserts bypass business validation.
2. **Option 2: Operative Reservations Outside Ledger (Strategy A)**
   * Available balance computed as `cleared_balance - sum(active_reservations)`.
   * *Rejected:* Prone to double-counting during clearing settlement; historical replay of journal lines cannot reconstruct the exact reserved state.
3. **Option 3: Hardened Ledger with `SECURITY DEFINER` Gateway, Append Guards, and Accounted Reservations (Strategy B) - SELECTED**
   * Direct write access to `account_balances`, `journal_entries`, and `journal_lines` is completely revoked from `spbk_app`.
   * Single authorized transactional gateway (`ledger.fn_post_transfer`) executes transfers atomically under `SECURITY DEFINER` with fixed `search_path`.
   * Deferred constraint trigger validates zero-sum balance and locks the entry (`is_locked = TRUE`).
   * Pre-insert trigger on `journal_lines` physically blocks appending lines to locked entries.
   * Reservations are modeled as zero-sum journal movements between customer available liability (`2101`) and in-flight reserved liability (`2102`).

## Decision Outcome

**Chosen Option: Option 3.**

### Key Architectural Guarantees:

1. **Real Inmutability & Append Rejection:**
   * Deferred trigger `trg_verify_journal_balance` validates minimum 2 lines and zero-sum balance at `COMMIT`, then sets `journal_entries.is_locked = TRUE`.
   * Trigger `trg_prevent_append_to_locked_entry` rejects any `INSERT` into `journal_lines` if the parent entry is locked.
   * Triggers `trg_prevent_journal_entries_mutation` and `trg_prevent_journal_lines_mutation` reject all `UPDATE` and `DELETE` attempts.
2. **Single Authorized Transactional Gateway (`fn_post_transfer`):**
   * Role `spbk_app` has ZERO write permissions on financial tables (`42501 permission denied` on direct write attempts).
   * Posting occurs exclusively through `fn_post_transfer`, which atomically handles validation, deterministic locking, balance checks, journal posting, projection updates, and outbox event persistence.
3. **Continuous Audit Reconciliation (`fn_audit_reconcile_balances`):**
   * Provides an independent SQL function to dynamically recalculate exact historical balances from `journal_lines` and detect any drift against `account_balances`.
4. **Reservation Strategy B (Accounted Reservations):**
   * Moving funds from available to reserved is a genuine double-entry transfer between `2101:Available` and `2102:Reserved`.
   * Guarantees that historical line summation reproduces the exact available/reserved breakdown without relying on external tables.
5. **Three-Tier Deadlock Defense:**
   * Removes unrealistic claims of absolute deadlock impossibility.
   * *Tier 1:* Deterministic lexicographical locking (`LEAST(source, dest)` then `GREATEST(source, dest)`).
   * *Tier 2:* Database timeout tuning (`deadlock_timeout = 100ms`, `statement_timeout = 5s`).
   * *Tier 3:* Application retry interceptor for `40P01` and `40001` with exponential jittered backoff.

## Verification & Status

All invariants were executed and verified against a genuine PostgreSQL 18 container via Testcontainers (`platform/packages/ledger/src/experimental/__tests__/ledger-invariants.integration.spec.ts`). All 12 test suites passed:
* Rejection of direct `UPDATE` on `account_balances` by `spbk_app` (error `42501`).
* Rejection of direct `INSERT` on `journal_entries` and `journal_lines` by `spbk_app` (error `42501`).
* Deferred commit-time rejection of unbalanced entries (error `23514`).
* Engine-level rejection of appending lines to locked entries (error `23505`).
* Atomic transfer execution and balance projection update via `fn_post_transfer`.
* Concurrency double-spending prevention under race conditions.
* Discrepancy-free balance audit reconciliation.

## Consequences

* **Positive:**
  * Financial integrity is enforced by the PostgreSQL 18 engine itself, rendering direct tampering or bypass impossible.
  * Zero balance drift; every balance change has an immutable accounting origin.
  * Auditability and BCRA/UIF regulatory compliance are mathematically verifiable.
* **Negative:**
  * Application must interface with the transactional stored procedure rather than executing raw ORM writes.
  * Requires disciplined maintenance of database migration scripts.
