# Technical Diagnostic and Legacy Codebase Audit: SaintPatrickBank

**Document Status:** Complete & Reviewed  
**Author:** Senior Software Architect  
**Project Target:** SaintPatrickBK (Argentine Fintech Wallet & PSP Platform)  
**Date of Audit:** October 26, 2026  
**Audited Location:** `POT/2-Proyectos con valor creativo, profesional o de dominio/SaintPatrickBank`

---

## 1. Executive Summary

This diagnostic presents a technical audit of the legacy `SaintPatrickBank` codebase. The existing codebase is an early educational/tutorial prototype constructed with the Laravel 11 framework. While it served to demonstrate superficial page navigation and basic relational persistence, **it lacks the foundational architectural, security, mathematical, and regulatory controls required of a regulated financial institution or payment service provider (PSP) in the Argentine Republic**.

Under regulatory guidelines from the Central Bank of Argentina (**BCRA**) and the Financial Information Unit (**UIF**), deploying the current implementation in a production environment would represent critical regulatory non-compliance, severe financial risk (double-spending, balance desynchronization), and immediate vulnerability to fraud and identity spoofing.

---

## 2. Inventory of Existing Components

The legacy codebase consists of 66 source files organized in a standard Laravel 11 skeleton:

| Component | Path | Purpose in Legacy Code | Technical Assessment |
| :--- | :--- | :--- | :--- |
| **User Model** | `app/Models/User.php` | Holds card number, pin, and balance as direct table columns | **Fatal Flaw:** Direct balance mutation (`users.balance`). PIN stored in plain/unhashed attribute. |
| **Transaction Model** | `app/Models/Transaction.php` | Single-entry transaction record (`user_id`, `receiver_card_number`, `amount`) | **Fatal Flaw:** Single-entry logging. No double-entry accounting. No debit/credit pairs. No transaction status machine. |
| **Auth Controller** | `app/Http/Controllers/AuthController.php` | Basic session login checking `card_number` and `pin` | **Vulnerable:** Uses card numbers as login identifiers with no multi-factor authentication (MFA), rate limiting, or brute-force protection. |
| **Transaction Controller** | `app/Http/Controllers/TransactionController.php` | Deducts from sender, credits receiver via direct update | **Critical Risk:** Prone to race conditions, double-spending, lack of serializable locking, and unhandled network failures. |
| **Database Migrations** | `database/migrations/2024_06_17_*` | Creates `users`, `transactions`, and `sessions` tables | Naive schema design. `balance` and `amount` columns lack precision constraints or are declared as standard decimals without currency tracking. |
| **Frontend Templates** | `resources/views/pages/*.blade.php` | Blade views with Tailwind CDN | Simple UI templates mimicking an ATM/online banking portal. Uses Laravel default red accent (`#FF2D20`) and dark theme. |

---

## 3. Critical Financial, Security, and Architectural Flaws

### 3.1. Absence of Double-Entry Ledger (Direct Balance Mutation)
In `app/Http/Controllers/TransactionController.php`, transfers are executed by directly modifying the `balance` field of the sender and recipient:
```php
// Existing legacy logic:
$user->balance -= $amount;
$user->save();
```
* **Why this is catastrophic:** Money cannot be altered through an isolated `UPDATE` statement. In financial engineering, balance is an **aggregate derived from an immutable double-entry journal** (Assets, Liabilities, Equity, Revenues, Expenses). If a single update fails midway, funds vanish or are created from thin air without audit trails.

### 3.2. Floating-Point and Unvalidated Monetary Types
The legacy migrations and models do not enforce integer centavos (`BigInt`) or exact numeric representations (`NUMERIC(18,4)`). Operating with standard floats or unconstrained numbers results in IEEE-754 precision errors, roundoff leakage, and irreconcilable ledger discrepancies.

### 3.3. Authentication and Credential Storage
* The `User` model sets `pin` as fillable. While it is hidden in serialization, it does not use a cryptographic memory-hard key derivation function (e.g., Argon2id or bcrypt with appropriate work factors) designed for PIN/password storage.
* Login relies solely on `card_number` and `pin`. In modern Argentine fintechs, identity is anchored on **validated tax IDs (CUIT/CUIL)**, verified email/phone, device fingerprinting, and obligatory Multi-Factor Authentication (MFA) under BCRA Communication "A" 8398.

### 3.4. Lack of Argentine Regulatory Integration
* **No CVU (Clave Virtual Uniforme):** Zero support for the 22-digit COELSA standard.
* **No KYC/AML:** No collection or validation of DNI, CUIT/CUIL, PEP (Politically Exposed Persons) status, or sanction lists (RePET), violating UIF Resolution 200/2024.
* **No Fund Backing Verification:** No tracking of customer stored value against dedicated 100% sight deposit bank accounts held in commercial banks, violating Apartado 4.1 of the Texto Ordenado del BCRA sobre Proveedores de Servicios de Pago.
* **No Fraud Management:** No preventive rules or fraud monitoring as mandated by BCRA Comunicación "A" 7463.
* **Prohibited Denomination Usage:** The word "Bank" in "SaintPatrickBank" directly violates **Article 19 of the Argentine Financial Entities Law (Ley 21.526)**, which reserves banking terminology exclusively for authorized credit institutions.

---

## 4. Preserved Assets: Brand Identity and Aesthetic Tokens

Although the entire backend and frontend architecture will be rewritten from scratch, the user has explicitly requested to **preserve the visual brand identity and color palette** established in the legacy portal:

* **Primary Accent Color:** `#FF2D20` / `#FF4D40` (Vibrant Coral Red, adopted from the original theme).
* **Dark Background Tokens:** Deep dark surfaces (`#000000`, `#09090b` / `zinc-950`, `#18181b` / `zinc-900`).
* **Light Surface Tokens:** `#FFFFFF`, `#F9FAFB` (`gray-50`), `#F4F4F5` (`zinc-100`).
* **Typography:** Clean geometric sans-serif (Figtree / Inter).
* **Working Project Name:** **SaintPatrickBK** (an internal working name replacing the prohibited word "Bank". Final commercial use remains subject to formal trademark and regulatory clearance).


---

## 5. Retirement and Controlled Replacement Plan

To respect the principle of **zero destructive actions without verification**:
1. The entire legacy Laravel project will remain preserved in Git history on branch `develop` and tagged as `legacy-v1-archive`.
2. A new monorepo structure will be established alongside the documentation.
3. No legacy database migration or table will be reused; a brand new PostgreSQL schema will be initialized.
4. Legacy files will be decommissioned in phases once the new core domain modules achieve verified parity and test coverage.
