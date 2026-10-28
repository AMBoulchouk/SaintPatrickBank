# SaintPatrickBK Platform Monorepo (Phase 2 Baseline)

This directory contains the foundational technical monorepo for **SaintPatrickBK**, built with:
* **Runtime:** Node.js 24 LTS
* **Language:** TypeScript 5.8+ Strict Mode
* **API Engine:** NestJS 11 + Fastify
* **Persistence:** PostgreSQL 18 via Docker Compose
* **Package Manager:** pnpm v12 (Workspaces)
* **Testing:** Vitest with Testcontainers

---

## 1. Quickstart

### Prerequisites
* Node.js `>= 24.0.0`
* pnpm `>= 10.0.0` (or `corepack enable`)
* Docker & Docker Compose

### Initial Setup
```bash
# From within platform/
pnpm install

# Start local PostgreSQL 18 instance (localhost:5432 only)
pnpm docker:up

# Verify database health
pnpm docker:ps

# Run unit tests across all packages
pnpm test

# Build all packages and applications
pnpm build

# Start the API Gateway in development mode
pnpm dev
```

The API will be available at: `http://127.0.0.1:3000/health`.

---

## 2. Monorepo Structure

```text
platform/
├── apps/
│   └── api/                    # Ingress REST API Gateway (NestJS 11 + Fastify)
├── packages/
│   ├── shared-kernel/          # Core Value Objects (Money exact BigInt, Result<T, E>)
│   ├── infrastructure/         # Structured logger with PII scrubbers, DB pool configs
│   ├── ledger/                 # Ledger bounded context envelope (Phase 3 implementation)
│   ├── accounts/               # Accounts & CVU lifecycle envelope
│   ├── compliance/             # KYC/KYB & UIF Res. 200/2024 compliance envelope
│   └── identity/               # Authentication & MFA security envelope
├── docker/
│   ├── docker-compose.yml      # PostgreSQL 18 Alpine service
│   └── initdb/
│       └── 01-init-databases.sql # Dev & test DBs with least-privilege roles
├── .env.example                # Canonical environment variable templates
├── pnpm-workspace.yaml         # Workspace package glob definitions
├── tsconfig.base.json          # Root strict TypeScript configuration
└── vitest.workspace.ts         # Multi-package test discovery
```

---

## 3. Coexistence with Legacy Laravel Codebase

To respect the principle of **zero destructive modifications**:
* The legacy Laravel 11 project remains completely untouched in the parent directory (`../`).
* No legacy file was modified, overwritten, or deleted.
* All modern financial infrastructure is encapsulated within `platform/`.

---

## 4. Pending Reviews

See [`../docs/PENDING-REVIEWS.md`](../docs/PENDING-REVIEWS.md) for the formal registry of items to be reviewed before Phase 3 implementation.
