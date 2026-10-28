# SaintPatrickBK: Formal Registry of Pending Technical & Regulatory Reviews

**Document Status:** Official Architectural Tracking Registry  
**Governance:** Architecture Committee & Regulatory Compliance  
**Last Updated:** Phase 2 Technical Baseline Establishment (October 2026)

> [!IMPORTANT]
> The architectural models, regulatory analyses, and token specifications recorded in `docs/` represent baseline blueprints for development and planning. **None of these items are certified or finalized merely by virtue of documentation.** Each requires explicit engineering verification, formal commercial agreements, or regulatory clearance prior to production deployment.

---

## 1. Accounting Invariants: Engine Implementation & Stress Testing
* **Scope:** Verification of formal double-entry bookkeeping rules in PostgreSQL 18.
* **Items Scheduled for Review Before Implementation:**
  * Mandatory balanced entry enforcement ($\sum \text{Debits} - \sum \text{Credits} = 0$) at transaction commit time.
  * Explicit prohibition of empty journal entries (must contain at least one debit and one credit).
  * Absolute immutability of posted entries (`POSTED` status).
  * **Explicit Rejection Policy:** Avoiding `DO INSTEAD NOTHING` rules that silently hide illegal updates; enforcing explicit database exceptions that return verifiable error codes.
  * Granular database access privileges for financial tables (restricting direct mutations from application roles).
  * Concurrency constraints, serialized row-level locks, and anti-double-spending checks (`available_balance_cents >= 0`).
  * Database transaction retry policies: avoiding arbitrary global timeouts (`deadlock_timeout = 100ms` or `statement_timeout = 5000ms`) until benchmarked under simulated load.
  * Consistency and snapshot rebuild capability of materialized balances.

---

## 2. Idempotency & Concurrency: Final Implementation Details
* **Scope:** Distributed transaction safety and client network retry handling.
* **Items Scheduled for Review:**
  * Strict implementation of IETF `draft-ietf-httpapi-idempotency-key-header`.
  * Behavioral policy for payload mismatches (immediate `HTTP 422 IDEMPOTENCY_PAYLOAD_MISMATCH` rejection).
  * Handling concurrent race conditions for identical keys (`HTTP 409 Conflict`).
  * **Clarification on Retention:** The 48-hour retention window for HTTP idempotency keys is an API transit buffer and **does not replace the permanent uniqueness constraint of underlying monetary transfers and journal sequence IDs**.

---

## 3. Definitive Regulatory Operating Model
* **Scope:** Legal classification before the Central Bank of Argentina (BCRA).
* **Items Scheduled for Review:**
  * Decision between:
    * **Direct PSPCP:** Direct registration before BCRA, custody account opening under T.O. PSP 4.1, direct COELSA membership, and direct reporting under UIF Res. 200/2024.
    * **PSPCP as a Service (Com. "A" 8432):** Outsourced infrastructure model through an authorized sponsor institution.
  * Review of contractual requirements, SLA definitions, and liability allocation.

---

## 4. Banking & CVU External Integrations (Unconfirmed Dependencies)
* **Scope:** External financial connectivity.
* **Items Scheduled for Review:**
  * Selection and contracting of the commercial sponsor bank for the 100% sight deposit account (T.O. PSP Apartado 4.1).
  * Formal bilateral agreement, VPN setup, and homologation testing with COELSA for 22-digit CVU allocation and Transferencias 3.0 clearing.
  * Selection of biometric and national identity verification provider (Direct Renaper access vs. certified identity vendors such as VU Security / Veritran).
  * Real-time anti-fraud telemetry integrations under BCRA Comunicación "A" 7463 and "A" 8398.

---

## 5. Commercial Brand Validation: "SaintPatrickBK"
* **Scope:** Trademark clearance and regulatory denomination compliance.
* **Items Scheduled for Review:**
  * Status of "SaintPatrickBK" is strictly an **internal technical and working title**.
  * Formal trademark availability search and registration before the National Institute of Industrial Property (**INPI**).
  * Legal confirmation that the abbreviation "BK" does not induce public confusion regarding commercial bank status under **Article 19 of Law 21.526**.

---

## 6. Final Review of Design Tokens and Accessibility (WCAG 2.1 AA)
* **Scope:** Cross-platform design tokens and financial UX clarity.
* **Items Scheduled for Review:**
  * Re-verification of mathematical contrast ratios on final OLED and LCD mobile device targets.
  * Implementation of high-contrast mode for printed PDF receipts and statements (enforcing darkened `#C41C12` variant against light canvas).
  * Automated linting and browser visual regression testing for tabular financial figures (`tabular-nums`) and statutory transparency disclaimers (T.O. PSP Apartado 4.2).
