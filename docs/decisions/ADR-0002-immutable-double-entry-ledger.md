# ADR-0002: Enforcement of Immutable Double-Entry Ledger, Exact Monetary Representation, and Deadlock Handling

**Status:** Accepted (Updated with Concurrency & Engine Invariant Controls)  
**Deciders:** Senior Software Architect, Lead Engineering Team  
**Date:** October 26, 2026  
**Context & Scope:** Financial Integrity and Ledger Core for SaintPatrickBK

---

## Context and Problem Statement

The legacy system stored user balances as a single mutable column on the `users` table (`users.balance`) and updated it with direct arithmetic mutations (`$user->balance -= $amount`). In financial systems, direct balance mutations make auditing impossible, cause race conditions under concurrent requests, and violate fundamental regulatory accounting rules required by the BCRA (including fund availability backing under Apartado 4.1 of the Texto Ordenado de PSP). We must establish an immutable accounting model.

## Decision Drivers

* **Regulatory Compliance:** BCRA (T.O. PSP Apartado 4.1) and UIF require complete, tamper-evident audit trails of every centavo moved through the system.
* **Mathematical Precision:** Zero tolerance for roundoff errors or precision loss caused by binary floating-point representation (IEEE-754).
* **Auditability & Reversibility:** Any mistake or disputed charge must be reversible without rewriting history.
* **Concurrency & Deadlock Resilience:** Concurrent transfers must not suffer from unhandled deadlocks or race conditions.

## Considered Options

1. **Option 1: Single-Entry Accounting with Transaction History Table**
   * *Cons:* A single ledger debit or credit table is vulnerable to desynchronization; does not account for the corresponding asset side (e.g., bank sight deposits); does not balance to zero.
2. **Option 2: Immutable Double-Entry Bookkeeping (Selected)**
   * *Pros:* Every journal entry contains balanced debit and credit lines summing to zero ($\sum D - \sum C = 0$). Balances are derived projections of history. Full audit trail compliant with GAAP, BCRA, and international banking standards.

## Decision Outcome

**Chosen Option: Option 2 (Immutable Double-Entry Bookkeeping Engine).**

### Core Invariants Enforced:
1. **Engine-Level Zero-Sum Transaction Invariant:** Every `JournalEntry` must balance to zero across all its lines. This is enforced at the database level via a `DEFERRABLE INITIALLY DEFERRED` constraint trigger, guaranteeing that unbalanceable entries are rolled back even if triggered by direct database access.
2. **Absolute Immutability:** Database-level rules prohibit `UPDATE` or `DELETE` statements on `entry_lines` and `journal_entries`. Corrections are executed solely via compensatory reversal entries (*storno*).
3. **Exact Minor Unit Representation & Serialization:**
   * All monetary amounts are stored and calculated as 64-bit integers (`BIGINT`) representing minor currency units (centavos in ARS).
   * **Serialization Rule:** In REST JSON APIs and event contracts, monetary values are serialized strictly as **strings** (e.g., `"amount_cents": "100050"`) to avoid 64-bit truncation in client runtimes that adhere to IEEE-754 ($2^{53}-1$ limit).
4. **Anti-Double-Spending Protection:** A check constraint on the materialized `account_balances` table (`CHECK (available_balance_cents >= 0)`) prevents overdrafts at the database level.
5. **Deadlock Strategy (Prevention, Detection, and Retry):**
   * *Prevention:* Deterministic lexicographical sorting of account IDs before locking.
   * *Detection:* PostgreSQL `deadlock_timeout = '100ms'` and `statement_timeout = '5000ms'`.
   * *Application Retry:* Automatic retries with exponential backoff and full jitter on PostgreSQL error codes `40P01` (`deadlock_detected`) and `40001` (`serialization_failure`).

## Consequences

* **Positive:** Mathematically impossible to create or destroy money without an unbalanced transaction being rejected by database constraints; complete auditability for regulators and auditors; full balance snapshot rebuild capability; automated recovery from transient database lock contention.
* **Negative:** Requires slightly more lines of code and deliberate schema design compared to naive CRUD updates. Fully justified given the financial criticality of the platform.
