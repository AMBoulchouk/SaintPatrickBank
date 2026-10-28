# Double-Entry Ledger Core Specification: SaintPatrickBK

**Document Status:** Corrected & Verified Core Engineering Specification  
**Authority:** Financial Ledger Core Engine  
**Domain Package:** `packages/ledger`  
**Mathematical Base:** Formal Double-Entry Bookkeeping (Luca Pacioli Standard)

---

## 1. Foundational Accounting Principles

The Ledger Core is the **single source of financial truth** for SaintPatrickBK. All balances, statements, and audits are mathematically derived from it.

### Core Invariants:
1. **The Dual-Leg Rule (Partida Doble):** Every financial transaction consists of a `JournalEntry` containing at least two `EntryLine` items (one debit and one credit).
2. **Zero-Sum Balance Invariant:**
   $$\sum \text{Debits} - \sum \text{Credits} = 0$$
   No entry can be committed to persistence if the net sum is non-zero.
3. **Absolute Immutability:** Once a `JournalEntry` is posted (`POSTED`), it can **never** be edited, updated, or deleted. Corrections are handled exclusively by issuing a new compensatory offsetting entry (Storno / Reversal).
4. **Exact Monetary Types (Zero Floating-Point):**
   * Currency amounts are represented strictly as **64-bit Signed Integers** (`BigInt`) representing the minor currency unit (cents / *centavos* in Argentine Pesos: $1.00 ARS = 100 centavos) or using exact database types (`NUMERIC(18, 4)` / `BIGINT`).
   * **IEEE-754 floating-point numbers (`float`, `double`, `number` in JS without custom packaging) are strictly prohibited** across all entities, APIs, and persistence models.
5. **JSON API & Event Serialization of Monetary Values:**
   * Because standard JSON does not support 64-bit `BigInt` natively and JavaScript runtime numbers lose precision beyond $2^{53} - 1$ (9,007,199,254,740,991, or ~90 trillion centavos), **all monetary amounts in REST APIs, OpenAPI schemas, and JSON event contracts must be serialized as strings** (e.g., `"amount_cents": "100050"`). DTO transformers and Zod schemas enforce string-to-BigInt validation at system boundaries.

---

## 2. Standard Chart of Accounts (Fintech Topology)

Accounts are classified into the five canonical accounting classes:

| Class | Account Category | Normal Balance | Purpose in SaintPatrickBK |
| :--- | :--- | :--- | :--- |
| **1000** | **Assets (Activo)** | **Debit** | Physical/bank holdings: 100% sight deposit backing accounts in authorized commercial banks (T.O. PSP Apartado 4.1). |
| **2000** | **Liabilities (Pasivo)** | **Credit** | Customer Stored Value (*Saldos de Clientes en Cuentas de Pago*). The fintech owes this money to the wallet users. |
| **3000** | **Equity (Patrimonio Neto)** | **Credit** | Company regulatory capital, statutory reserves, retained earnings. |
| **4000** | **Revenues (Ingresos)** | **Credit** | Collected transaction fees, interchange fees, FX margins. |
| **5000** | **Expenses (Egresos)** | **Debit** | Clearing settlement costs, bank maintenance fees, infrastructure operational expenses. |

### Canonical Account Layout:
```text
1000 - ASSETS
  ├── 1100: Cash and Bank Sight Deposits
  │     └── 1101: Commercial Bank Sight Account (100% Backing under T.O. PSP 4.1)
  └── 1200: Clearing & Settlement Transit Accounts
        ├── 1201: COELSA Inbound Clearing Transit
        └── 1202: COELSA Outbound Clearing Transit
2000 - LIABILITIES
  ├── 2100: Customer Stored Value (Payment Accounts)
  │     ├── 2101: Customer Payment Accounts (Individual sub-accounts per user)
  │     └── 2102: In-Flight Reserved Funds (Pending outbound transfer settlement)
  └── 2200: Third-Party Payable (Tax withholdings, AFIP/ARCA, IIBB)
4000 - REVENUE
  └── 4100: Fee Income (Transfer fees, merchant processing fees)
```

---

## 3. Transactional Flows and Fund States

### 3.1. States of Funds and Reservation Rules
To prevent double-spending while managing asynchronous external clearing:
* **Available Balance (`available_balance_cents`):** Funds cleared and immediately spendable by the user.
* **Reserved Balance (`reserved_balance_cents`):** Funds earmarked for an ongoing outbound operation, locked against concurrent spending.
* **Cleared Balance (`cleared_balance_cents`):** Total ledger liability owed to the user ($= \text{Available} + \text{Reserved}$).

### 3.2. Detailed Transactional Flows

#### Flow A: Inbound Transfer (Cash-In from Bank to Wallet via COELSA)
1. Funds arrive in the commercial bank sight deposit account (Asset).
2. The ledger records:
   * **DEBIT (+ Asset):** `Account 1101 (Bank Sight Account)` → +\$10,000.00 ARS (1,000,000 centavos)
   * **CREDIT (+ Liability):** `Account 2101:User:12345 (User Payment Account)` → +\$10,000.00 ARS (1,000,000 centavos)
   * **Net Balance:** $+1,000,000 - 1,000,000 = 0$.

#### Flow B: Peer-to-Peer Transfer (Internal Wallet to Wallet)
1. Synchronously executed in a single atomic transaction:
   * **DEBIT (- Liability):** `Account 2101:User:A (Sender)` → -\$2,500.00 ARS (250,000 centavos)
   * **CREDIT (+ Liability):** `Account 2101:User:B (Receiver)` → +\$2,500.00 ARS (250,000 centavos)
   * **Net Balance:** $-250,000 + 250,000 = 0$.
   * **Result:** Total fintech liabilities remain unchanged; internal ownership shifts instantaneously.

#### Flow C: Outbound Transfer (Cash-Out to External CBU via COELSA)
1. **Stage 1 (Reservation):**
   * Move from available to reserved:
     * `account_balances.reserved_balance_cents += amount`
     * `account_balances.available_balance_cents -= amount`
   * Ledger booking:
     * **DEBIT (- Liability):** `Account 2101:User:A` → -\$5,000.00 ARS
     * **CREDIT (+ Liability):** `Account 2102 (Customer Funds In-Flight)` → +\$5,000.00 ARS
2. **Stage 2 (Clearing Confirmation Received):**
   * **DEBIT (- Liability):** `Account 2102 (Customer Funds In-Flight)` → -\$5,000.00 ARS
   * **CREDIT (- Asset):** `Account 1101 (Bank Sight Account)` → -\$5,000.00 ARS
   * Operation completed.
3. **Stage 2 Alt (Clearing Rejection / Timeout Reversal):**
   * If external network rejects the transfer, a compensatory storno entry is posted:
     * **DEBIT (- Liability):** `Account 2102 (Customer Funds In-Flight)` → -\$5,000.00 ARS
     * **CREDIT (+ Liability):** `Account 2101:User:A` → +\$5,000.00 ARS
   * Reserved balance is released back to available balance.

---

## 4. PostgreSQL Database Enforcement of Invariants

To guarantee financial integrity even if an operator or direct script accesses the database, PostgreSQL enforces balancing rules at the database engine level.

### 4.1. Deferred Constraint Trigger for Zero-Sum Validation
PostgreSQL checks that every journal entry balances to zero at transaction commit time:

```sql
-- Table of Journal Entries
CREATE TABLE journal_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id BIGSERIAL NOT NULL UNIQUE,
    idempotency_key VARCHAR(255) NOT NULL UNIQUE,
    description TEXT NOT NULL,
    posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table of Individual Debit/Credit Lines
CREATE TABLE entry_lines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE RESTRICT,
    account_id UUID NOT NULL REFERENCES ledger_accounts(id),
    direction VARCHAR(6) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
    amount_cents BIGINT NOT NULL CHECK (amount_cents > 0),
    currency VARCHAR(3) NOT NULL DEFAULT 'ARS'
);

-- Function to Verify Balance at Commit Time
CREATE OR REPLACE FUNCTION verify_journal_entry_balance()
RETURNS TRIGGER AS $$
DECLARE
    net_balance BIGINT;
BEGIN
    SELECT COALESCE(SUM(
        CASE WHEN direction = 'DEBIT' THEN amount_cents ELSE -amount_cents END
    ), 0)
    INTO net_balance
    FROM entry_lines
    WHERE journal_entry_id = NEW.journal_entry_id;

    IF net_balance <> 0 THEN
        RAISE EXCEPTION 'Journal entry % does not balance. Net delta: % centavos', 
            NEW.journal_entry_id, net_balance
            USING ERRCODE = '23514'; -- check_violation
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DEFERRED Constraint Trigger: Executed at COMMIT time
CREATE CONSTRAINT TRIGGER trg_verify_journal_balance
AFTER INSERT OR UPDATE ON entry_lines
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION verify_journal_entry_balance();

-- Rules Preventing Mutation or Deletion of Existing Lines
CREATE OR REPLACE RULE entry_lines_no_update AS ON UPDATE TO entry_lines DO INSTEAD NOTHING;
CREATE OR REPLACE RULE entry_lines_no_delete AS ON DELETE TO entry_lines DO INSTEAD NOTHING;
```

---

## 5. Concurrency, Deadlock Strategy, and Double-Spending Protection

### 5.1. Protection Against Double-Spending
1. **Engine-Level Non-Negative Balance Constraint:**
   ```sql
   ALTER TABLE account_balances 
   ADD CONSTRAINT chk_available_balance_non_negative 
   CHECK (available_balance_cents >= 0);
   ```
   If concurrent threads attempt to draw from an account, the database engine physically rejects any transaction that would push `available_balance_cents` below zero.
2. **Pessimistic Row Locking (`FOR UPDATE`):**
   Before inspecting or altering balance, the row is locked:
   ```sql
   SELECT available_balance_cents FROM account_balances 
   WHERE account_id = $1 
   FOR UPDATE;
   ```

### 5.2. Comprehensive Deadlock Strategy (Prevention, Detection & Retries)
While sorting account IDs lexicographically prevents simple deadlocks in two-party transfers, **it cannot mathematically guarantee zero deadlocks across complex multi-table transactions** (foreign key validation locks, outbox insertions, index page splits, or batch balance updates).

SaintPatrickBK therefore implements a **three-tier deadlock management strategy**:
1. **Tier 1 (Prevention):** Deterministic sorting of account IDs before acquiring row locks in any transaction.
2. **Tier 2 (Database Detection):**
   * `deadlock_timeout = '100ms'` in PostgreSQL to rapidly identify cyclic lock waits.
   * `statement_timeout = '5000ms'` to avoid holding locks during network stalls.
3. **Tier 3 (Application-Level Retry Policy):**
   * If PostgreSQL aborts a transaction with error codes:
     * `40P01` (`deadlock_detected`)
     * `40001` (`serialization_failure`)
   * The application-level transaction interceptor automatically retries the operation using **Exponential Backoff with Full Jitter** (base delay: 50ms, multiplier: 2.0, max retries: 3).
   * If all 3 retries are exhausted, the operation fails cleanly with an explicit error, releasing all client locks.
