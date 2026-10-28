# Persistence, Concurrency, Idempotency, and Financial Integrations

**Document Status:** Corrected & Verified Engineering Specification  
**Architecture Domain:** Persistence, Asynchronous Processing, and External Boundaries  
**Target Platform:** SaintPatrickBK (Fintech Engine)

---

## 1. Idempotency Architecture and Standardization Status

In distributed financial architectures, client retries following network timeouts can cause double-charging unless guarded by robust idempotency controls.

### 1.1. Standards Clarification: IETF Draft vs. RFC 9110
* **RFC 9110 (HTTP Semantics):** Defines standard HTTP methods (`GET`, `PUT`, `DELETE` are semantically idempotent; `POST` is non-idempotent by default).
* **The `Idempotency-Key` Header:** It is specified in the **IETF HTTPAPI Working Group Draft (`draft-ietf-httpapi-idempotency-key-header`)**, not within RFC 9110 itself.
* **SaintPatrickBK Adherence:** We implement the IETF draft specification pattern across all mutating financial endpoints (`POST /transfers`, `POST /accounts/reservations`, etc.).

### 1.2. Idempotency Policy Matrix

| Scenario | Incoming Request | Idempotency Key Table State | System Action & Response |
| :--- | :--- | :--- | :--- |
| **New Operation** | Fresh Key | Key does not exist | Insert key in `PROCESSING` status; execute transaction; update to `COMPLETED` with response body; return `HTTP 201 Created`. |
| **Identical Retry** | Matching Key + Identical SHA-256 payload hash | Key in `COMPLETED` status | Bypass domain logic; return cached `response_code` and `response_body` (e.g. `HTTP 201/200`) with header `Idempotency-Replay: true`. |
| **Payload Mismatch** | Matching Key + **Different** request payload hash | Key in `PROCESSING` or `COMPLETED` | **Reject immediately.** Return `HTTP 422 Unprocessable Entity` with error code `IDEMPOTENCY_PAYLOAD_MISMATCH`. The key cannot be recycled for a different transaction. |
| **Concurrent Race** | Same Key received simultaneously by two workers | Key in `PROCESSING` status | Second request receives `HTTP 409 Conflict` with error message `"A request with this idempotency key is currently being processed"`. |
| **Operation Failure** | Key in `FAILED` status | Transient error (e.g. database timeout) | Key is unlocked or marked `FAILED`, allowing the client to retry with the same key. |
| **Retention Policy** | Key older than retention window | Time-to-Live (TTL) exceeded | Idempotency records are maintained for **48 hours** in the database, after which an automated pruning worker purges them. |

---

## 2. Transactional Outbox Pattern & Idempotent Event Consumers

To eliminate the dual-write anti-pattern (committing to the database while failing to dispatch an event to Kafka or an external queue), SaintPatrickBK employs the **Transactional Outbox Pattern**:

```
+-------------------------------------------------------------------+
|                       PostgreSQL Transaction                      |
|                                                                   |
|  1. Insert Journal Entry & Debit/Credit Lines                     |
|  2. Update Account Balances (Locked Row)                          |
|  3. Insert Event into `outbox_events` (Status: 'PENDING')         |
|                                                                   |
|                           [ COMMIT ]                              |
+-------------------------------------------------------------------+
                                  |
                                  v
                        +-------------------+
                        |   Outbox Worker   | (Polls with SKIP LOCKED or LISTEN)
                        +-------------------+
                                  |
            +---------------------+---------------------+
            |                                           |
            v                                           v
[ Notification Service Worker ]              [ External Clearing Worker ]
```

### 2.1. Consumer-Side Deduplication
Because message delivery over networks is inherently **at-least-once**, all internal and external consumers must process events idempotently.
* Every dispatched event carries a unique `event_id` (UUIDv4) and a monotonic sequence number.
* Each consumer maintains a local deduplication table:
  ```sql
  CREATE TABLE processed_events (
      event_id UUID NOT NULL,
      consumer_name VARCHAR(100) NOT NULL,
      processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (event_id, consumer_name)
  );
  ```
* Before applying business logic, the consumer executes:
  ```sql
  INSERT INTO processed_events (event_id, consumer_name) 
  VALUES ($1, $2) 
  ON CONFLICT DO NOTHING;
  ```
  If zero rows are inserted, the event has already been processed and is acknowledged immediately without re-executing logic.

---

## 3. Account Structure, CVU Generation, and Verification

### 3.1. Official CVU Structure (COELSA 22-Digit Standard)
A Clave Virtual Uniforme (CVU) in the Argentine National Payment System consists of exactly 22 numeric digits divided into two blocks:

```text
[ BBB B SSS C ] [ AAAAAAAAAAAAA C ]
|--- Block 1 ---| |---- Block 2 ----|
    8 Digits          14 Digits
```

1. **Block 1 (8 digits) - Identification of the PSP:**
   * Digits 1–3 (`BBB`): Institutional code assigned by the BCRA (e.g., `000` for virtual payment accounts).
   * Digits 4–7 (`SSSS`): PSP branch or specific system identifier.
   * Digit 8 (`C`): Check digit calculated over the first 7 digits using a **Weighted Modulo-10 Algorithm** with repeating weight sequence: `[7, 1, 3, 9, 7, 1, 3]`.
2. **Block 2 (14 digits) - Customer Account Identification:**
   * Digits 9–21 (`AAAAAAAAAAAAA`): 13-digit internal account sequence number.
   * Digit 22 (`C`): Check digit calculated over digits 9–21 using a **Weighted Modulo-10 Algorithm** with repeating weight sequence: `[3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]`.

### 3.2. Technical Generation vs. Operational Activation
* **Technical Validation & Checksum Calculation:** Algorithmic verification of check digits is handled locally in `packages/accounts` via certified unit tests.
* **Operational Assignment:** Real routing of a CVU across the national financial network requires the 8-digit institution code to be registered in the **COELSA National Directory of Accounts and Aliases**. Until formal integration and bilateral authorization are executed, SaintPatrickBK creates accounts in an internal staging format.

---

## 4. Financial Account Typology & Terminology Distinctions

SaintPatrickBK strictly distinguishes between the different accounts involved in the operation:

1. **Cuentas de Respaldo Bancario (Cuentas a la vista - Apartado 4.1 T.O. PSP):**
   * Bank accounts held at authorized commercial banks in Argentina under the ownership of the fintech but designated exclusively to hold customer funds.
   * Funds are 100% available on demand and cannot be encumbered or lent.
2. **Cuentas Contables Internas del Ledger:**
   * Virtual accounts inside `packages/ledger` representing specific liabilities (Customer Stored Value 2101) or system clearing transits (COELSA Inbound Transit 1201).
3. **Cuentas Operativas de la Fintech:**
   * Commercial bank accounts holding company capital (for payroll, server expenses, and fee revenues). Completely segregated from customer funds.
4. **Obligaciones del Banco Depositario:**
   * The commercial bank hosting the sight deposit accounts is an independent financial entity subject to its own BCRA reserve and liquidity requirements. It is solely responsible for certifying account balances to the BCRA upon request.

---

## 5. Justified Reconciliation Architecture

Rather than imposing arbitrary "daily tri-party" reconciliation, SaintPatrickBK models reconciliation according to the natural operational cadence of each interface:

```
+---------------------------------------------------------------------------------------+
|  Reconciliation Tier      | Frequency         | Scope                                 |
+---------------------------+-------------------+---------------------------------------+
| 1. Internal Ledger Audit  | Continuous        | Verifies that Materialized Balance    |
|                           | (Automated Worker)| equals SUM(Journal Lines) for all     |
|                           |                   | active accounts.                      |
+---------------------------+-------------------+---------------------------------------+
| 2. Clearing Settlement    | Per Clearing Cycle| Matches internal transfer records     |
|    Reconciliation         | (Aligned with     | against COELSA clearing files         |
|                           | COELSA windows)   | (T+0 intra-day or T+1 daily settlement)|
+---------------------------+-------------------+---------------------------------------+
| 3. Bank Backing Audit     | Daily             | Compares end-of-day bank statement feed|
|                           | (Close of Business| against total active wallet balance   |
|                           | / COB)            | to verify compliance with T.O. PSP 4.1|
+---------------------------+-------------------+---------------------------------------+
```

---

## 6. Status of External Integrations

To maintain engineering transparency, the current status of all external connections is formally documented:

* **COELSA (Compensación Electrónica S.A.):** *Unconfirmed dependency.* Pending bilateral agreement, VPN setup, and sandbox homologation for Transferencias 3.0.
* **Commercial Sponsor Bank:** *Unconfirmed dependency.* Pending selection of commercial banking partner and execution of custody account agreements under Apartado 4.1 T.O. PSP.
* **Renaper (Registro Nacional de las Personas):** *Unconfirmed dependency.* Direct connection vs. certified private vendor integration (e.g. VU Security / Veritran) to be determined based on commercial evaluation.
* **Antifraud Telemetry Feeds:** *Unconfirmed dependency.* Under architectural evaluation.
