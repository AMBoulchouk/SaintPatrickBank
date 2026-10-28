# Target Architecture and Monorepo Blueprint: SaintPatrickBK

**Document Status:** Approved Architecture Blueprint  
**Standard:** Domain-Driven Design (DDD) & Modular Hexagonal Architecture  
**Monorepo Tooling:** pnpm Workspaces  
**Runtime:** Node.js 24 LTS | TypeScript 5.8+ Strict Mode | PostgreSQL 18

---

## 1. Architectural Strategy: The Evolutionary Modular Monolith

A common anti-pattern in early-stage fintech projects is adopting a distributed microservices topology on Day 1. Distributing financial operations across network boundaries before achieving domain stability introduces distributed transaction overhead (Two-Phase Commit / complex Sagas), eventual consistency windows where money can be duplicated, and immense operational fragility.

**SaintPatrickBK adopts an Evolutionary Modular Monolith within a pnpm Monorepo:**

```
+-----------------------------------------------------------------------------------+
|                               SaintPatrickBK Monorepo                             |
|                                                                                   |
|  +------------------------+  +------------------------+  +---------------------+  |
|  |     apps/api-gateway   |  |     apps/worker        |  |   apps/backoffice   |  |
|  |   (Fastify + NestJS)   |  | (Outbox & Scheduled)   |  | (Compliance & Ops)  |  |
|  +------------------------+  +------------------------+  +---------------------+  |
|              |                           |                          |             |
|  ============================== PACKAGES BOUNDED CONTEXTS ========================  |
|              |                           |                          |             |
|   +-----------------------+     +-------------------+    +---------------------+  |
|   |   identity-access     |     |   compliance-kyc  |    |     accounts-cvu    |  |
|   +-----------------------+     +-------------------+    +---------------------+  |
|              |                           |                          |             |
|   +----------------------------------------------------------------------------+  |
|   |                            LEDGER CORE (ENGINE)                            |  |
|   |         * Double-Entry Accounting * Exact BigInt * Strict Invariants       |  |
|   +----------------------------------------------------------------------------+  |
|              |                           |                          |             |
|   +-----------------------+     +-------------------+    +---------------------+  |
|   |  payments-transfers   |     |   reconciliation  |    |     risk-fraud      |  |
|   +-----------------------+     +-------------------+    +---------------------+  |
|              |                           |                          |             |
|   +----------------------------------------------------------------------------+  |
|   |                          SHARED KERNEL & CONTRACTS                         |  |
|   |           * Value Objects * Currency * Result<T, E> * Domain Events        |  |
|   +----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### Key Architectural Tenets:
1. **In-Process Strict Boundaries:** Each domain lives in an isolated package (`packages/*`) with its own domain model, public interfaces (ports), and internal persistence adapters.
2. **ACID Financial Atomicity:** The Ledger Core operates within transactional guarantees in PostgreSQL. Cross-boundary operations (e.g., executing a transfer and posting ledger journal entries) execute in a single serializable database transaction when internal, preventing distributed failure states.
3. **Transactional Outbox for Decoupled Events:** When asynchronous events are required (e.g., pushing audit logs, dispatching push notifications, or queuing external clearing), the event is written to an `outbox` table in the *same* database transaction as the business operation, guaranteed by the outbox relay.
4. **Zero Shared Kernel Bloat:** `shared-kernel` is restricted strictly to pure, ubiquitous primitive value objects (e.g., `Money`, `Currency`, `Cuit`, `Result<T, E>`). It never holds domain entities or cross-cutting business logic.

---

## 2. Technology Baseline and 2026 Versioning Justification

| Technology | Selection | Version / Lifecycle | Architectural Justification |
| :--- | :--- | :--- | :--- |
| **Runtime** | **Node.js** | **24.x LTS** | Active Long-Term Support in 2026. Delivers high asynchronous I/O throughput, native Fetch/WebStreams, built-in test runner capabilities, and stable V8 performance. |
| **Language** | **TypeScript** | **v5.8+ (Strict)** | Strict null checks, no implicit any, exact optional property types, and sound type safety essential for mission-critical monetary calculations. |
| **Application Framework** | **NestJS** | **v11.x** | Enterprise-grade dependency injection, module architecture, OpenAPI documentation generation, and architectural boundary enforcement. |
| **HTTP Engine** | **Fastify** | **v5.x** | High-performance low-overhead HTTP adapter for NestJS, with integrated schema validation and fast JSON serialization. |
| **Database** | **PostgreSQL** | **v18** | The gold standard for financial systems. Robust ACID transactions, row-level locking (`FOR UPDATE`), check constraints, generated columns, and declarative partitioning. |
| **Query Engine** | **Kysely / Typed SQL** | **Latest Stable** | End-to-end type safety without the hidden N+1 queries, memory overhead, or opaque transaction models common in heavy ORMs like TypeORM. |
| **Package Management** | **pnpm Workspaces** | **v10.x** | Hard-link efficiency, strict dependency isolation (prevents phantom dependencies), and rapid monorepo script execution. |
| **Testing** | **Vitest** | **v3.x** | Fast, modern execution engine for unit, integration, and architecture tests with native TypeScript and ESM support. |
| **Observability** | **OpenTelemetry** | **v1.x** | Vendor-neutral distributed tracing, structured logging, and metrics exporter compatible with Prometheus and Grafana. |

---

## 3. Monorepo Structural Layout

```text
saintpatrickbk/
├── apps/
│   ├── api/                     # Main REST/OpenAPI ingress gateway
│   │   ├── src/
│   │   └── package.json
│   ├── worker/                  # Outbox event processor, scheduled reconciliations
│   │   ├── src/
│   │   └── package.json
│   └── backoffice-api/          # Ops, compliance, manual review & dual-approval gateway
│       ├── src/
│       └── package.json
├── packages/
│   ├── identity/                # Authentication, sessions, MFA, credential hashing
│   ├── compliance/              # KYC/KYB, CUIT/CUIL validation, PEP/sanctions, UIF risk scoring
│   ├── accounts/                # Virtual payment accounts, account lifecycle, CVU & Alias rules
│   ├── ledger/                  # IMMUTABLE DOUBLE-ENTRY CORE: Journal, entries, balances, accounts
│   ├── payments/                # Transfer orchestration (internal, Coelsa Transferencias 3.0, QR)
│   ├── reconciliation/          # Settlement validation, bank statement matching, discrepancy alerts
│   ├── fraud/                   # Velocity limits, anomaly detection, device fingerprint checks
│   ├── reporting/               # Regulatory audit trails, BCRA regime reporting, tax withholding
│   ├── notifications/           # Push/Email transaction alerts (isolated from financial path)
│   ├── integrations/            # Outbound adapters (Coelsa, Renaper, sponsor bank APIs)
│   ├── shared-kernel/           # Value Objects: Money, Cuit, Cvu, AccountNumber, Result<T, E>
│   └── infrastructure/          # Database connection pools, migrations runner, telemetry setup
├── docs/                        # Complete architectural and regulatory repository
│   ├── architecture/
│   ├── regulatory/
│   ├── decisions/
│   └── brand/
├── docker/                      # Development containers (PostgreSQL 18, Redis local, Mailhog)
├── pnpm-workspace.yaml
├── package.json
├── tsconfig.base.json
└── vitest.workspace.ts
```

---

## 4. Bounded Contexts and Domain Responsibilities

### 4.1. Identity & Access (`packages/identity`)
* **Scope:** Identity credentials, cryptographic password/PIN hashing (Argon2id), session tokens, Multi-Factor Authentication (TOTP / WebAuthn / SMS OTP), device authorization, and role-based access control (RBAC).
* **Invariant:** No user can perform an administrative or financial action without an active, verified session matching their registered device fingerprint.

### 4.2. Identity Verification & Compliance (`packages/compliance`)
* **Scope:** Legal onboarding of physical persons (humanas) and legal entities (jurídicas). Validation of national identity (DNI) and tax IDs (CUIT/CUIL). Screening against RePET (Terrorist Sanction Registry), PEP lists, and Interpol notices. Customer risk profile assignment under UIF Resolution 200/2024.
* **Boundary:** Does not handle payments or account numbers. Emits `CustomerVerifiedEvent` or `CustomerFlaggedEvent`.

### 4.3. Accounts & CVU (`packages/accounts`)
* **Scope:** Representation of virtual payment accounts (*Cuentas de Pago* under BCRA regulations). Account status lifecycle (`PENDING_KYC`, `ACTIVE`, `BLOCKED`, `FROZEN_LEGAL`, `CLOSED`). CVU algorithmic generation, Modulo-10 checksum calculation, and Alias management.
* **Separation of Concerns:** The technical generation and mathematical validation of a 22-digit CVU is distinct from its live operational assignment. Live assignment requires official registration of the PSP prefix in the COELSA national routing directory.
* **Invariant:** An account cannot transition to `ACTIVE` without a verified identity signal from `compliance`.

### 4.4. Ledger Core (`packages/ledger`)
* **Scope:** **The absolute financial authority of the system.** Enforces strict double-entry accounting. Maintains the Chart of Accounts, immutable Journal Entries, debit/credit legs, balance projections, and reserves (including compliance tracking with Apartado 4.1 of the T.O. PSP).
* **Invariant:** Every journal entry must have a net sum of exactly zero. Direct modification or deletion of posted entries is physically prohibited by database constraints and trigger rules.

### 4.5. Payments & Transfers (`packages/payments`)
* **Scope:** Orchestration of inbound and outbound money movements. Manages transfer state machines (`INITIATED`, `PENDING_FUNDS_RESERVATION`, `POSTED_INTERNAL`, `CLEARING_OUTBOUND`, `CONFIRMED`, `REJECTED`, `REVERSED`).
* **Boundary:** Interacts with `ledger` via transactional commands to reserve or settle funds.

### 4.6. Reconciliation & Settlement (`packages/reconciliation`)
* **Scope:** Verification between internal ledger balances, commercial bank sight deposit accounts (T.O. PSP Apartado 4.1), and clearinghouse settlement files.
* **Invariant:** Any discrepancy between internal customer liabilities and commercial bank assets triggers automated alerts and freezes automated clearing until audited.

