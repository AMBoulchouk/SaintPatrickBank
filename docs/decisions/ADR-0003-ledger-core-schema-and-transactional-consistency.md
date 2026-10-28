# ADR-0003: Ledger Core Schema Design, Mathematical Invariants, and Transactional Consistency

**Status:** Proposed (Design Contract for Phase 3)  
**Deciders:** Senior Software Architect, Lead Engineering Team  
**Date:** October 27, 2026  
**Context & Scope:** Core Financial Ledger for SaintPatrickBK

---

## Context and Problem Statement

SaintPatrickBK requires a single, inviolable financial source of truth capable of operating in the Argentine financial ecosystem under BCRA and UIF oversight. The system must guarantee that:
1. No funds are ever created, destroyed, or lost to precision/rounding anomalies.
2. Direct balance mutation is physically impossible.
3. Concurrent spending requests cannot result in double-spending.
4. All postings are immutable and fully auditable.
5. Invariants are enforced by PostgreSQL 18 constraints, not solely by application-layer code.

## Decision Drivers

* **Regulatory Inviolability:** BCRA T.O. PSP (Apartado 4.1) and UIF Res. 200/2024 require complete, tamper-evident audit trails.
* **Double-Spending Prevention:** Concurrency control must withstand high-frequency simultaneous requests without race conditions.
* **Mathematical Exactness:** Strict conservation of money ($\sum D - \sum C = 0$) and 64-bit integer centavos.
* **Explicit Rejection:** Any operation violating accounting or consistency rules must fail with an explicit, traceable error; silent failures or `DO INSTEAD NOTHING` workarounds are prohibited.
* **Audit Reproducibility:** Point-in-time balances must be 100% reproducible from historical journal lines.

## Considered Options

1. **Option 1: Naive Relational Updates (Legacy Approach)**
   * Single balance column on customer row updated via arithmetic `UPDATE`.
   * *Rejected:* Unauditable, zero-sum impossible to verify, prone to race conditions and phantom money creation.
2. **Option 2: Pure Event Sourcing with In-Memory Aggregate Projection**
   * Storing unconstrained domain events in an event store, projecting balances dynamically into Redis or memory.
   * *Rejected:* Lacks database-level relational constraints; cross-account zero-sum invariants cannot be guaranteed at database commit time without distributed locks.
3. **Option 3: Relational Immutable Double-Entry Ledger with Materialized Projection & Deterministic Locking (Selected)**
   * Immutable `journal_entries` and `journal_lines` tables.
   * Zero-sum deferred constraint trigger at `COMMIT` time.
   * Materialized `account_balances` table for $O(1)$ balance reads and pessimistic row-level locking (`FOR UPDATE`).
   * Distinct `financial_operations` state machine to decouple asynchronous business lifecycles from instantaneous accounting postings.

## Decision Outcome

**Chosen Option: Option 3 (Relational Immutable Double-Entry Ledger).**

### Key Structural Invariants Enforced:
1. **Separation of Concerns:** Business operations (`financial_operations`) model asynchronous lifecycle states (`INITIATED`, `PENDING_EXTERNAL_CONFIRMATION`, `CONFIRMED`, `REJECTED`, `REVERSED`), while `journal_entries` represent instantaneous, immutable accounting postings (`POSTED`).
2. **Engine-Level Zero-Sum Validation:** Deferred constraint trigger validates $\sum D - \sum C = 0$ per currency and $\text{lines} \ge 2$ at commit time.
3. **Strict Line Validation:** All `journal_lines` must have `amount_cents > 0` and direction `DEBIT` or `CREDIT`. No negative line amounts.
4. **Account Nature-Specific Availability:** Customer liability accounts enforce `available_balance_cents >= 0` to physically block overdrafts. Other accounts (asset, equity, revenue, expense) operate under their natural debit/credit polarities.
5. **Deterministic Row Locking:** Multi-account transfers acquire row-level locks on `account_balances` in strict ascending lexicographical order of `account_id` to prevent cyclic deadlocks.
6. **Transactional Outbox Co-Commit:** Outbox events are persisted in the exact same database transaction as the journal entry, guaranteeing at-least-once asynchronous event delivery.
7. **Explicit Rejection Policy:** Discarded modifications trigger explicit PostgreSQL exceptions (`RAISE EXCEPTION`); silent rules (`DO INSTEAD NOTHING`) are banned.

## Consequences

* **Positive:**
  * Mathematically impossible for uncoordinated code or direct SQL access to commit unbalanced entries.
  * Complete protection against concurrent double-spending.
  * Point-in-time balance snapshots can be reconstructed from scratch.
  * Clean separation between external clearing workflows and internal accounting.
* **Negative:**
  * Slightly higher write amplification (writing journal entry + lines + balance update + outbox event in one transaction).
  * Requires strict developer adherence to deterministic lock acquisition ordering.
