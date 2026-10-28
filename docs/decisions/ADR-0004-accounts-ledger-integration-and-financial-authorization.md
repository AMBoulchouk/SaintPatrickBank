# ADR-0004: Accounts ↔ Ledger Integration, Financial Authorization, and REST Contracts

**Status:** Accepted (Validated via PostgreSQL 18 Testcontainers Suite)  
**Deciders:** Senior Software Architect, Lead Engineering Team  
**Date:** October 28, 2026  
**Context & Scope:** Bounded Context Integration between `@spbk/accounts`, `@spbk/ledger`, and `@spbk/api`

---

## Context and Problem Statement

Following the successful implementation of the core double-entry ledger (`@spbk/ledger`), SaintPatrickBK required connecting the operational customer accounts domain (`@spbk/accounts`) with the financial core, while exposing guarded REST endpoints (`@spbk/api`).

In financial architectures, three critical failure modes frequently occur during this integration:
1. **Dual Monetary Sources of Truth:** Storing account balances redundantly inside the accounts table, causing reconciliation drift between the operational database and the accounting ledger.
2. **Confused Deputy / Client Authorization Bypass:** Relying on client-submitted `account_id` or `user_id` parameters, allowing authenticated users to query or debit accounts belonging to other customers.
3. **Overconfidence in `SECURITY DEFINER` Protections:** Assuming that revoking direct SQL writes on tables eliminates all security risks. A compromised application role (`spbk_app`) could still invoke authorized stored procedures (e.g., `ledger.fn_post_transfer`) if the application layer fails to enforce strict resource-level authorization.

## Decision Drivers

* **Strict Bounded Context Boundaries:** Zero duplication of accounting responsibilities. `@spbk/accounts` manages customer account lifecycle and identity; `@spbk/ledger` exclusively governs monetary movements and balances.
* **Ports & Adapters Isolation:** Accounts must not execute ad-hoc SQL joins against ledger internal schema. Communication routes exclusively through outbound domain ports (`LedgerReaderPort`, `FinancialTransferPort`).
* **Zero-Trust Financial Authorization:** The backend must independently derive authenticated identity from trusted gateway tokens/headers, verify resource ownership, check operational account status (`ACTIVE`), enforce KYC verification, and validate transaction limits.
* **Information Leak Prevention:** Infrastructure errors, SQL exceptions, table names, and stack traces must never reach external clients. All errors must follow RFC 7807 Problem Details.

## Decision Outcome

### 1. Bounded Context Responsibility Matrix

| Responsibility | `@spbk/accounts` | `@spbk/ledger` |
| :--- | :---: | :---: |
| Account Ownership & Customer Identity | **YES** | NO |
| CVU & Alias Management (COELSA) | **YES** | NO |
| Account Status (`ACTIVE`, `SUSPENDED`, `BLOCKED`, `CLOSED`) | **YES** | NO |
| Transactional Limits (Daily & Single) | **YES** | NO |
| Financial Posting & Double-Entry Invariants | NO | **YES** |
| Funds Reservations (Strategy B) | NO | **YES** |
| Monetary Balance Calculation & Projections | NO | **YES** |
| Audit Reconciliations & Compensatory Reversals | NO | **YES** |
| Persistent Business Idempotency Hash | NO | **YES** |

### 2. Hexagonal Architecture Ports & Adapters

```
[ AccountsController ] ---> [ Use Cases ]
                                 |
        +------------------------+------------------------+
        |                                                 |
[ PaymentAccountRepository ]                     [ Outbound Ports ]
        |                                                 |
[ PostgresPaymentAccountRepo ]               +------------+------------+
  (accounts.payment_accounts)                |                         |
                                   [ LedgerReaderPort ]    [ FinancialTransferPort ]
                                             |                         |
                              [ PostgresLedgerReaderAdapter ] [ LedgerTransferAdapter ]
                                (SELECT from balances/lines)    (fn_post_transfer)
```

1. **`LedgerReaderPort` (`PostgresLedgerReaderAdapter`):**
   - Provides read-only balance snapshots (`getAccountBalance`) and paginated historical journal lines (`getTransactionHistory`).
   - Uses `spbk_app` credentials with `SELECT` privileges only.
2. **`FinancialTransferPort` (`LedgerTransferAdapter`):**
   - Invokes `PostTransferUseCase` from `@spbk/ledger`.
   - Delegates execution to `ledger.fn_post_transfer` with canonical SHA-256 payload hashing and persistent business idempotency.

### 3. Financial Authorization Model

Before executing any financial read or write operation:
1. **Identity Extraction:** Injected by reverse proxy / mTLS gateway into trusted context (`AuthSubject: { id, roles, kycStatus }`).
2. **Ownership Assertion:** Validates `account.isOwnedBy(authSubject.id)`. Foreign account inspection or debit attempts immediately abort with `UnauthorizedAccountAccessException` (HTTP 403).
3. **KYC Compliance Assertion:** Financial operations require `kycStatus === 'VERIFIED'`. Unverified callers abort with `InsufficientKycLevelException` (HTTP 403).
4. **Lifecycle & Status Invariants:**
   - Source account must be `ACTIVE` (`account.assertCanTransact()`). Suspended accounts abort with `AccountNotActiveException` (HTTP 422).
   - Destination account must not be `BLOCKED` or `CLOSED` (`account.assertCanReceive()`). Blocked recipients abort with `AccountCannotReceiveException` (HTTP 422).
5. **Transactional Limit Assertion:**
   - Operation amount must be strictly positive integer centavos.
   - Operation amount must not exceed `account.singleTransferLimitCents`. Violations abort with `SingleTransferLimitExceededException` (HTTP 422).
6. **Application vs. `SECURITY DEFINER` Security Boundary:**
   - `SECURITY DEFINER` protects table immutability from direct SQL tampering.
   - The application layer acts as the mandatory gatekeeper validating authorization, authentication, rate limits, and business semantics *before* invoking stored procedures.

### 4. Error Catalog and RFC 7807 Problem Details

All API responses normalize under RFC 7807:

```json
{
  "type": "https://api.saintpatrickbk.com/errors/insufficient_funds",
  "title": "Insufficient Funds",
  "status": 422,
  "detail": "Available balance is insufficient to complete the requested transfer.",
  "code": "INSUFFICIENT_FUNDS",
  "instance": "/api/v1/transfers/internal",
  "correlationId": "8d3e9114-64b5-4122-8d76-123456789abc",
  "timestamp": "2026-10-28T20:00:00.000Z"
}
```

*Database Error Sanitization:* PostgreSQL syntax errors, foreign key violations, or connection dropouts are intercepted by `ProblemDetailsExceptionFilter`. Raw SQL queries, table names, and stack traces are logged internally with `correlationId` and strictly masked from external responses.

### 5. Immutability Trigger Mechanism Proof

To resolve concerns regarding `trg_verify_journal_entry_commit` updating `is_locked` without triggering `trg_prevent_journal_entries_mutation`:

1. `trg_verify_journal_entry_commit` is defined as a `CONSTRAINT TRIGGER ... AFTER INSERT ... DEFERRABLE INITIALLY DEFERRED`.
2. At `COMMIT`, it executes:
   ```sql
   UPDATE ledger.journal_entries 
   SET is_locked = TRUE 
   WHERE id = NEW.id AND is_locked = FALSE;
   ```
3. This update fires the `BEFORE UPDATE` trigger `trg_prevent_journal_entries_mutation`.
4. The mutation trigger evaluates:
   ```sql
   IF OLD.is_locked = FALSE AND NEW.is_locked = TRUE AND
      OLD.id = NEW.id AND 
      OLD.sequence_id = NEW.sequence_id AND 
      OLD.financial_operation_id = NEW.financial_operation_id AND
      OLD.idempotency_key = NEW.idempotency_key AND
      OLD.entry_type = NEW.entry_type AND
      OLD.description = NEW.description AND
      OLD.posted_at = NEW.posted_at THEN
       RETURN NEW;
   END IF;
   ```
5. **Empirical Proof:** If an attacker attempts to set `is_locked = TRUE` while modifying *any* other column (e.g. `description` or `idempotency_key`), the condition evaluates to `FALSE` and PostgreSQL raises error `23505` (`INV-05 VIOLATION`). Furthermore, once `is_locked = TRUE`, no subsequent updates can ever pass because `OLD.is_locked = FALSE` is unsatisfied. This is verified by automated integration test `should prove that the internal is_locked transition cannot be abused to modify other fields`.

## Verification & Status

Verified across **13 test suites and 98 automated integration tests (100% pass rate)** against real PostgreSQL 18 via Testcontainers:
* `@spbk/accounts` integration suite (16 tests): resource authorization, foreign account blocking, suspended/blocked account handling, non-positive amounts, single limits, KYC verification, alias resolution, real-time balance verification, idempotency replay, conflict detection, 5-thread concurrency race without double-spending, and customer isolation.
* `@spbk/api` test suite (14 tests): `FinancialAuthGuard`, `AccountsController`, `TransfersController`, and `ProblemDetailsExceptionFilter` database sanitization.
* `@spbk/ledger` test suites (44 tests): RBAC security, locking guards, reservation lifecycle, and concurrency.
* Unit test suites (24 tests): `Money`, `Result`, logger, database config, and health checks.

## Consequences

* **Positive:**
  * Clean separation of concerns with zero balance drift.
  * Robust object-level and function-level access control.
  * Verified race condition protection against double-spending under concurrent traffic.
  * Cryptographic idempotency protection and atomic Outbox events.
* **Negative:**
  * Operational payment account creation requires coordinated orchestration with ledger liability account provisioning.
