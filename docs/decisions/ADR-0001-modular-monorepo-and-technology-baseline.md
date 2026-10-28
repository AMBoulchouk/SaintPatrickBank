# ADR-0001: Adoption of Modular Monorepo Topology and Node.js 24 / TypeScript Baseline

**Status:** Accepted  
**Deciders:** Senior Software Architect, Lead Engineering Team  
**Date:** October 26, 2026  
**Context & Scope:** Architecture Baseline for SaintPatrickBK

---

## Context and Problem Statement

SaintPatrickBK is being re-engineered from an educational prototype into an enterprise-grade fintech wallet and payment service provider (PSP) operating in Argentina under BCRA regulations. We must select an architectural topology and technology stack that guarantees financial integrity, low latency, developer ergonomics, strict domain isolation, and future scalability without introducing premature distributed systems complexity.

## Decision Drivers

* **Financial Consistency:** Monetary transactions require strong ACID semantics; distributed cross-network transactions on Day 1 pose unacceptable financial loss risks.
* **Domain Isolation:** Strict separation of bounded contexts (`ledger`, `accounts`, `identity`, `compliance`, `payments`) to allow independent team ownership or selective microservice extraction later.
* **Modern Long-Term Support:** Modern 2026 LTS runtime and strict static typing.
* **Developer Velocity & Ergonomics:** Fast test cycles, zero phantom dependencies, and unified tooling.

## Considered Options

1. **Option 1: Distributed Microservices from Day 1 (Docker / Kubernetes / Kafka per service)**
   * *Cons:* Requires complex Two-Phase Commit (2PC) or Saga orchestrators for simple transfers; high operational overhead; eventual consistency risks in core balances.
2. **Option 2: Unstructured Monolith (Single package, shared database tables)**
   * *Cons:* Fast to start, but quickly turns into a "big ball of mud" where any module directly updates balances or circumvents ledger rules.
3. **Option 3: Modular Monolith in a pnpm Monorepo Workspace (Selected)**
   * *Pros:* In-process strong boundaries, package-level encapsulation, single ACID transaction envelope for critical financial paths, zero distributed network failure points on the core ledger, and trivial microservice extraction when needed.

## Decision Outcome

**Chosen Option: Option 3 (Modular Monolith with pnpm Workspaces).**

### Technical Baseline:
* **Runtime:** Node.js 24 LTS.
* **Language:** TypeScript 5.8+ with strict mode enabled (`noImplicitAny`, `strictNullChecks`, `exactOptionalPropertyTypes`).
* **Framework:** NestJS 11 with Fastify HTTP adapter.
* **Persistence:** PostgreSQL 18 with Kysely type-safe query builder and raw SQL migrations.
* **Package Manager:** pnpm v10+ with workspaces.
* **Testing:** Vitest with native TypeScript execution and Testcontainers for PostgreSQL integration.

## Consequences

* **Positive:** Complete elimination of distributed transaction bugs on Day 1; immediate transaction isolation; clean domain boundaries via package imports; sub-second unit test execution.
* **Negative:** Requires strict code review discipline to prevent developers from bypassing package public API interfaces (`index.ts` exports). Mitigated by architecture linting rules (e.g., `ts-arch` or ESLint dependency rules).
