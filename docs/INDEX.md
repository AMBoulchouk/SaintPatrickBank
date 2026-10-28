# SaintPatrickBK: Architectural & Regulatory Documentation Hub

**Platform Name:** SaintPatrickBK  
**Regulated Target:** Payment Service Provider offering Payment Accounts (PSPCP) / Digital Wallet  
**Jurisdiction:** Argentine Republic (BCRA / UIF / AAIP)  
**Engineering Baseline:** Node.js 24 LTS, TypeScript Strict, PostgreSQL 18, pnpm Monorepo  
**Brand Palette:** Vibrant Coral Red (`#FF2D20` / `#FF4D40`) on High-Contrast Zinc/Black Canvas

---

## Documentation Index

This directory contains the formal architectural blueprints, legacy audit, regulatory compliance matrices, and Architectural Decision Records (ADRs) governing the transformation of SaintPatrickBank into **SaintPatrickBK**.

### 1. Architectural Blueprints & Technical Specifications
* **[00. Technical Diagnostic & Legacy Codebase Audit](./architecture/00-diagnostic-and-legacy-audit.md)**
  * Exhaustive audit of the legacy Laravel 11 repository.
  * Identification of fatal financial flaws (direct `$user->balance` mutation, plaintext PINs, missing double-entry, lack of compliance).
  * Controlled legacy decommissioning and code preservation plan.
* **[01. Target Architecture & Monorepo Blueprint](./architecture/01-target-architecture-and-monorepo.md)**
  * The Evolutionary Modular Monolith strategy via pnpm Workspaces.
  * 2026 Technology baseline justification (Node 24 LTS, NestJS 11, Fastify, PostgreSQL 18, Kysely, Vitest).
  * Monorepo directory topology (`apps/`, `packages/`, `tools/`).
  * Bounded Context definitions, responsibilities, and domain invariants.
* **[02. Double-Entry Ledger Core Specification](./architecture/02-ledger-and-double-entry-accounting.md)**
  * Formal double-entry bookkeeping model (Assets, Liabilities, Equity, Revenues, Expenses).
  * Mathematical zero-sum invariant ($\sum D - \sum C = 0$) and absolute immutability.
  * Engine-level enforcement via PostgreSQL deferred constraint triggers.
  * Exact 64-bit integer representation of centavos (complete ban on IEEE-754 floats) with string serialization for JSON APIs.
  * Multi-tier deadlock management (prevention heuristic, detection, and exponential backoff retry).
* **[03. Persistence, Concurrency, and Financial Integrations](./architecture/03-persistence-concurrency-and-integrations.md)**
  * PostgreSQL 18 ACID isolation levels and partition strategy.
  * Kysely type-safe query builder evaluation vs. heavy ORMs.
  * IETF draft-compliant `Idempotency-Key` pipeline with mismatch rejection and concurrent conflict handling.
  * Transactional Outbox pattern accompanied by consumer-side deduplication tables.
  * Official COELSA 22-digit CVU structure and weighted Modulo-10 algorithms (distinguishing generation from live assignment).
  * Justified reconciliation cadences (continuous internal, per-cycle clearing, daily bank sight account backing).
* **[04. Testing Strategy, Security Architecture, and Failure Recovery](./architecture/04-testing-security-and-migration-plan.md)**
  * Multi-tiered test pyramid (Unit, Fast-check Property-based, PostgreSQL Testcontainers, Concurrency & Double-spending simulation, Contract testing).
  * Zero-trust security model, STRIDE threat modeling, AES-256-GCM as an engineering standard, and PII log redaction.
  * Comprehensive failure recovery criteria for monetary clearing timeouts and ambiguous states.
  * 8-Phase execution roadmap (Phase 0 through Phase 7) with dependencies and acceptance criteria.

* **[05. Ledger Core Formal Architecture, Data Model & Invariants](./architecture/05-ledger-core-formal-design.md)**
  * Complete entity-relationship model, boundary justification, mandatory mathematical invariants, append guard immutability, least privilege `SECURITY DEFINER` RBAC architecture (`spbk_ledger_owner`), Strategy B accounted reservation lifecycle, persistent idempotency (`client_reference_id` + SHA-256 hash), versioned PostgreSQL 18 migrations (001-005), and full Testcontainers integration test suite (67 tests, 100% pass).
* **[06. Formal Registry of Pending Reviews](./PENDING-REVIEWS.md)**
  * Explicit tracking of accounting invariants verification, concurrency benchmarking, regulatory operating model choice, external financial integrations, and commercial trademark validation.

---

### 2. Regulatory Compliance Framework (Argentine Republic)
* **[Compliance Matrix: BCRA, UIF & Data Protection](./regulatory/compliance-matrix-bcra-uif.md)**
  * Analysis of operating models: Full PSPCP vs. PSPCP as a Service (Com. "A" 8432) vs. Payment Initiator.
  * Comprehensive compliance matrix covering BCRA T.O. PSP Apartado 4.1 (100% sight deposit backing), Apartado 4.2 (mandatory transparency disclaimer), Com. "A" 7463 (fraud prevention in transfers), Com. "A" 8398 (cybersecurity & risk-based authentication), Com. "A" 8432 (outsourced PSPCP).
  * UIF Resolution 200/2024 compliance (KYC/KYB, PEP screening, RePET sanction lists, Risk-Based Approach).
  * Legal analysis of denomination restrictions under **Article 19 of Financial Entities Law 21.526** and status of SaintPatrickBK as a working title.

---

### 3. Architecture Decision Records (ADR)
* **[ADR-0001: Adoption of Modular Monorepo Topology and Node.js 24 / TypeScript Baseline](./decisions/ADR-0001-modular-monorepo-and-technology-baseline.md)**
* **[ADR-0002: Enforcement of Immutable Double-Entry Ledger, Exact Monetary Representation, and Deadlock Handling](./decisions/ADR-0002-immutable-double-entry-ledger.md)**
* **[ADR-0003: Ledger Core Schema Design, Mathematical Invariants, and Transactional Consistency](./decisions/ADR-0003-ledger-core-schema-and-transactional-consistency.md)**
* **[ADR-0004: Accounts ↔ Ledger Integration, Financial Authorization, and REST Contracts](./decisions/ADR-0004-accounts-ledger-integration-and-financial-authorization.md)**
* **[ADR-0005: Identity & Access Bounded Context, Cryptographic Sessions, and Reinforced Financial Authorization](./decisions/ADR-0005-identity-access-session-security-and-reinforced-financial-authorization.md)**
* **[OpenAPI 3.1 REST Specification v1](./api/openapi-v1.json)**


---

### 4. Brand & Design System Tokens
* **[Design System & UI/UX Modernization Specification](./brand/design-system.md)**
  * Complete design system guide, accessibility validation (WCAG 2.1 AA), typography rules, and mobile-first UX paradigms.
* **[Brand Tokens Reference](./brand/tokens.md)**
  * Full token documentation and color tokens rationale.
* **[W3C Design Tokens JSON](./brand/tokens.json)**
  * Machine-readable design tokens specification for automated tooling and frontend compilation.
* **[CSS Custom Properties](./brand/design-tokens.css)**
  * Drop-in CSS variables ready for the upcoming web client and backoffice frontends.
* **Brand Assets:**
  * [Official Horizontal Logo SVG](./brand/assets/logo-saintpatrickbk.svg)
  * [Official Geometric Isotype SVG](./brand/assets/isotype-saintpatrickbk.svg)
  * [Preserved Legacy Graphic Resource SVG](./brand/assets/legacy-mark.svg)


---

## Official Regulatory & Engineering References

1. **BCRA – Regulación del Sistema Nacional de Pagos:**  
   [https://www.bcra.gob.ar/regulacion-del-sistema-nacional-de-pagos/](https://www.bcra.gob.ar/regulacion-del-sistema-nacional-de-pagos/) *(Consulted: Oct 2026)*
2. **BCRA – Comunicación "A" 8398 (Ciberseguridad y Fraude):**  
   [https://www.bcra.gob.ar/archivos/Pdfs/comytexord/A8398.pdf](https://www.bcra.gob.ar/archivos/Pdfs/comytexord/A8398.pdf) *(Consulted: Oct 2026)*
3. **BCRA – Comunicación "A" 8432 (PSPCP como Servicio):**  
   [https://www.bcra.gob.ar/archivos/Pdfs/comytexord/A8432.pdf](https://www.bcra.gob.ar/archivos/Pdfs/comytexord/A8432.pdf) *(Consulted: Oct 2026)*
4. **UIF – Resolución 200/2024 (Prevención de LA/FT/FP para PSP):**  
   [https://www.argentina.gob.ar/normativa/nacional/407429/texto](https://www.argentina.gob.ar/normativa/nacional/407429/texto) *(Consulted: Oct 2026)*
5. **Node.js Releases Schedule (Node 24 LTS):**  
   [https://nodejs.org/en/about/previous-releases](https://nodejs.org/en/about/previous-releases) *(Consulted: Oct 2026)*
6. **PostgreSQL Documentation (MVCC & Concurrency Control):**  
   [https://www.postgresql.org/docs/18/mvcc.html](https://www.postgresql.org/docs/18/mvcc.html) *(Consulted: Oct 2026)*
