# Testing Strategy, Security Governance, and Failure Recovery: SaintPatrickBK

**Document Status:** Corrected & Verified Engineering Plan  
**Standard:** Enterprise Financial Testing, Zero-Trust Architecture, and Operational Continuity  
**Target:** SaintPatrickBK (Production-Ready Architecture)

---

## 1. Multi-Tiered Testing Strategy

In financial engineering, test suites must verify that balances and ledger invariants remain strictly conserved under heavy concurrent load, network partitioning, and hardware reboots.

```
       / \
      / E2E \           -> Complete User Journeys (Onboarding -> Transfer -> Balance)
     /-------\
    / Concurrency \     -> Multi-threaded Double-Spending Simulations & Lock Contention
   /---------------\
  /   Integration   \   -> Real PostgreSQL 18 Testcontainers, Kysely Migrations, Row Locks
 /-------------------\
/        Unit         \ -> Domain Invariants, Double-Entry Zero-Sum, CVU Modulo-10, Money Math
-----------------------
```

### 1.1. Specialized Test Suites and Invariant Criteria

| Test Suite | Tooling | Focus Area | Mandatory Verification Criteria |
| :--- | :--- | :--- | :--- |
| **Unit Tests** | **Vitest** | Domain entities, Value Objects, Journal Entry balancing | $\sum \text{Debits} - \sum \text{Credits} = 0$. Pure in-memory calculation with zero network/disk I/O. |
| **Property-Based Tests** | **fast-check + Vitest** | Generative testing over arbitrary sequences of operations | 100,000 randomized sequences of deposits, transfers, and reversals preserve total liability integrity. |
| **Integration Tests** | **Vitest + Testcontainers** | Real PostgreSQL 18 instance running in Docker | Verifies deferred constraint triggers, check constraints, row-level locks, and Kysely query execution. |
| **Double-Spending Simulation** | **Worker Threads** | Concurrent requests attempting to spend a single balance | When 50 concurrent threads attempt to draw \$1,000 from an account with only \$1,000: **exactly 1 succeeds**; 49 fail with `INSUFFICIENT_FUNDS`. Available balance never drops below zero. |
| **Idempotency & Replay** | **Vitest** | Replaying requests with matching and differing payloads | Replayed requests with matching payload return cached responses; replayed requests with altered payloads return `HTTP 422 IDEMPOTENCY_PAYLOAD_MISMATCH`. |
| **Deadlock & Retry Tests** | **Vitest** | Inducing circular lock contention across accounts | Verifies that PostgreSQL `40P01` triggers the application retry interceptor and cleanly resolves via exponential backoff. |

---

## 2. Security Governance and Information Architecture

### 2.1. Statutory Scope of Ley 25.326 vs. Technical Implementation
* **Statutory Requirement (Ley 25.326, Art. 9):** Requires the data controller to adopt technical and organizational measures necessary to guarantee the security and confidentiality of personal data, preventing alteration, loss, or unauthorized access.
* **Engineering Implementation:** Ley 25.326 **does not mandate a specific cryptographic algorithm**. SaintPatrickBK adopts **AES-256-GCM** (Galois/Counter Mode) with authenticated data (AEAD) as an **industry engineering best practice**, not as a statutory mandate.

### 2.2. Information Classification Framework

| Data Tier | Scope & Data Elements | Storage & Encryption Controls | Access & Retention Policy |
| :--- | :--- | :--- | :--- |
| **Tier 1: Restricted (Critical PII & Auth)** | Passwords, PIN hashes, biometrics, symmetric data keys. | Argon2id for credentials; AES-256-GCM for sensitive fields; KMS-backed envelope encryption. | Zero access by general staff; masked in all logs; strictly segregated databases. |
| **Tier 2: Confidential (Financial & Identity)** | Account balances, ledger entries, DNI, CUIT/CUIL, transaction counterparty names. | Encrypted at rest (PostgreSQL tablespace encryption / column encryption); TLS 1.3 in transit. | Role-Based Access Control (RBAC); audit-logged access; retained 10 years per Commercial Code. |
| **Tier 3: Internal (Operational Telemetry)** | System logs, application traces, aggregate metrics. | Plain text storage with automated PII scrubbers in log pipelines. | Retained 90 days; access restricted to engineering and security operations. |
| **Tier 4: Public (Disclosures & Policies)** | Terms of service, statutory transparency disclaimers, public API docs. | Public CDN / web servers. | Unrestricted public access; version-controlled in repository. |

---

## 3. Monetary Failure Recovery and Continuity Criteria

Financial operations are vulnerable to partial failures during external network hops. SaintPatrickBK establishes strict failure recovery criteria across all financial stages:

```
[ Customer Initiates Transfer ]
               |
               v
  (1) Internal Ledger Reservation: [ SUCCESS ]
               |
               v
  (2) External Call to Clearing / COELSA: [ TIMEOUT / NETWORK FAILURE ]
               |
               +---> Scenario A: Ambiguous External State
               |     * System marks transfer as `PENDING_EXTERNAL_CONFIRMATION`.
               |     * Automated polling worker queries clearing gateway status.
               |     * Funds remain locked in `reserved_balance_cents` (no double-spend).
               |
               +---> Scenario B: Confirmed Network Rejection
               |     * System triggers automatic compensatory Storno entry.
               |     * Funds released from `reserved_balance_cents` back to `available_balance_cents`.
               |     * User notified with explicit failure explanation.
               |
               +---> Scenario C: Unreconciled End-of-Day Discrepancy
                     * Isolated in Suspense Ledger.
                     * Requires Dual-Approval (Maker-Checker) review before settlement.
```

---

## 4. Phased Execution Roadmap

```
[Phase 0: Discovery & Regulatory Blueprint]  <--- COMPLETED (Current Milestone)
                     |
                     v
[Phase 1: Architecture & ADR Finalization]  <--- Foundation & RFC Review
                     |
                     v
[Phase 2: Monorepo & Technical Foundation]  <--- pnpm, TypeScript Strict, PostgreSQL 18, Docker
                     |
                     v
[Phase 3: Core Financial Engine]            <--- Ledger, Double-Entry, Accounts, Vitest TDD
                     |
                     v
[Phase 4: Identity & Compliance]            <--- KYC, CUIT/CUIL, Biometrics, Renaper, UIF
                     |
                     v
[Phase 5: Payments & Clearing]              <--- Transferencias 3.0, COELSA, QR, Idempotency
                     |
                     v
[Phase 6: Backoffice & Operations]          <--- Dual-Approval Maker-Checker, Reconciliations
                     |
                     v
[Phase 7: Pre-Production & Audit]           <--- Penetration Testing, BCRA Audit Readiness
```
