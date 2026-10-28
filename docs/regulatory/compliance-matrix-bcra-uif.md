# Argentine Regulatory Compliance Matrix: SaintPatrickBK

**Document Status:** Corrected & Verified Baseline Compliance Matrix  
**Regulatory Jurisdiction:** Argentine Republic  
**Applicable Regulators:** Banco Central de la República Argentina (BCRA), Unidad de Información Financiera (UIF), Agencia de Acceso a la Información Pública (AAIP)  
**Date of Audit & Reference Verification:** October 26, 2026

---

## 1. Operating Model Analysis: Legal Classification for SaintPatrickBK

To operate within the Argentine regulatory perimeter, SaintPatrickBK must formally classify its legal and operational profile before the Central Bank of Argentina (**BCRA**):

### 1.1. Modality A: Registered Payment Service Provider Offering Payment Accounts (PSPCP)
* **Governing Body:** Central Bank of Argentina (BCRA).
* **Principal Regulation:** **Texto Ordenado del BCRA sobre Proveedores de Servicios de Pago (T.O. PSP)**, complementarias y concordantes.
* **Core Responsibilities:**
  * Mandatory registration in the *Registro de Proveedores de Servicios de Pago* prior to commercial operation.
  * Allocation and administration of Cuentas de Pago and 22-digit CVU (Clave Virtual Uniforme).
  * Direct reporting under BCRA regulatory inform regimes.
  * Direct obligation as Reporting Entity (*Sujeto Obligado*) before the UIF under Resolution 200/2024.

### 1.2. Modality B: User-Facing Wallet via PSPCP as a Service (PSPCPaaS)
* **Principal Regulation:** **Comunicación "A" 8432** (and related regulations on outsourcing and contractual arrangements).
* **Core Responsibilities & Distinctions:**
  * **The Master Licensed PSPCP:** Holds the regulatory registration, manages the underlying payment accounts, maintains the 100% sight deposit backing in commercial banks, administers CVU generation under its institutional code, and reports directly to the BCRA.
  * **SaintPatrickBK (Third-Party Wallet Client):** Provides the frontend user experience, branding, and customer acquisition. Operates under a formal contract defining service-level agreements (SLA), customer data privacy segregation, technical access controls, and joint fraud prevention mechanisms.

### 1.3. Strict Distinction of Financial Terminology
To avoid technical and legal ambiguity, SaintPatrickBK enforces precise distinctions:
* **Segregación Patrimonial:** The legal separation between the proprietary corporate assets of the fintech and the funds belonging to payment account holders.
* **Disponibilidad y Respaldo al 100% en Cuentas a la Vista (Apartado 4.1 T.O. PSP):** The regulatory mandate that customer stored value must remain at all times deposited in sight accounts (*cuentas a la vista*) in authorized commercial banks in Argentina, available immediately upon customer demand.
* **Encaje Bancario:** A technical monetary policy reserve ratio applied exclusively by the BCRA to authorized financial institutions (commercial banks), not directly to fintechs.
* **Fideicomiso:** A specific legal trust structure governed by the Argentine Civil and Commercial Code. While some fintechs utilize trust accounts as an extra safeguard, a trust is legally distinct from a standard escrow sight deposit account (*cuenta a la vista para custodia de fondos de terceros*).

---

## 2. Denomination and Trademark Restrictions: Ley 21.526

> [!CAUTION]
> **Legal Restrictions on Denominations (Ley 21.526 de Entidades Financieras, Artículo 19):**  
> Under **Article 19 of Law 21.526**, only entities authorized by the BCRA as financial institutions (commercial banks, investment banks, mortgage banks, financial companies) may utilize in their corporate name, trade name, commercial documentation, or advertising the words:  
> *"banco", "banca", "banquero", "financiera"* or foreign equivalents (such as "Bank").  
> 
> **Status of "SaintPatrickBK":**  
> **SaintPatrickBK** is established strictly as an **internal technical and working denomination**.  
> The abbreviation "BK" does **not** grant automatic exemption from regulatory scrutiny or potential trademark disputes. Before any public or commercial launch, the final trade name must undergo:
> 1. Formal trademark search and clearance before the National Institute of Industrial Property (**INPI**).
> 2. Legal review by regulatory counsel to ensure it does not induce public confusion regarding the legal nature of the entity.

---

## 3. Mandatory Transparency Disclaimer (Apartado 4.2 T.O. PSP)

Under **Section 4.2 of the Texto Ordenado sobre Proveedores de Servicios de Pago**, all communications, mobile applications, web portals, account statements, and publicity issued by a PSPCP must visibly and legibly incorporate the mandatory legal disclaimer:

> *"Los fondos depositados en cuentas de pago no constituyen depósitos en una entidad financiera, ni cuentan con ninguna de las garantías que los depósitos tienen de acuerdo con la legislación y reglamentación aplicables en materia de depósitos en entidades financieras."*

**Technical Design Requirement:**  
This legend must be permanently visible in the footer of the wallet application, onboarding screens, and official web portals, rendered with an accessible contrast ratio meeting WCAG 2.1 AA standards.

---

## 4. Comprehensive Regulatory Compliance Matrix

| Regulatory Authority | Exact Regulatory Source & Article | Concrete Legal Obligation | Applicability to SaintPatrickBK | Responsible Module | Technical & Operational Controls | Evidence of Compliance | Pending Legal & Operational Validations |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **BCRA** | **T.O. Proveedores de Servicios de Pago, Apartado 4.1** *(Respaldo de fondos)* | Customer payment account funds must be backed 100% in liquid sight deposit accounts at authorized commercial banks in pesos. | **MANDATORY** for PSPCP. | `ledger`, `reconciliation` | Automated continuous balance verification: $\sum \text{Customer Liabilities} \le \text{Commercial Bank Asset}$. Any shortfall triggers an immediate critical halt. | Daily settlement reconciliation logs; automated balance matching reports. | Requires signed contract with commercial sponsor bank for custody account opening. |
| **BCRA** | **T.O. Proveedores de Servicios de Pago, Apartado 4.2** *(Transparencia)* | Mandatory inclusion of the statutory disclaimer stating funds are not bank deposits and have no deposit insurance. | **MANDATORY** across all user-facing interfaces. | `identity`, `apps/api` | Static layout integration of statutory legend in UI templates, PDF receipts, and onboarding flows. | Visual UI audit; automated DOM test checking legend presence on all views. | Review of font size and placement by legal counsel. |
| **BCRA** | **Comunicación "A" 7463** *(Transferencias y Fraude)* | Mandatory fraud monitoring, suspicious transaction profiling, and preventive mechanisms in payment transfers. | **MANDATORY** for transfer execution. | `fraud`, `payments` | Transaction velocity rules; cooling-off periods for newly linked accounts; anomaly detection before transfer dispatch. | Incident logging; rate-limit enforcement reports; blocked fraudulent transfer logs. | Calibration of anomaly scoring thresholds against operational volume. |
| **BCRA** | **Comunicación "A" 8398 (2026)** *(Ciberseguridad y Gestión de Riesgos)* | Risk-based cybersecurity management, incident reporting, and strong authentication based on operational risk profile. | **MANDATORY.** Controls must be proportioned to transaction risk. | `identity`, `fraud` | Multi-Factor Authentication (MFA) triggered on high-risk actions (e.g., transfers over threshold, device change, password reset); encrypted device binding. | MFA challenge logs; penetration test reports; risk-scoring telemetry. | Establishing concrete threshold amounts for mandatory MFA triggers. |
| **BCRA** | **Comunicación "A" 8432 (2026)** *(PSPCP como Servicio)* | Sets contractual, operational, and data governance frameworks when outsourcing PSPCP capabilities. | Applicable if operating via an authorized infrastructure partner. | `integrations`, `compliance` | Clear segregation of customer data; audit logging of outsourced operations; SLA monitoring. | Executed service contract with regulated sponsor institution; technical architecture diagram. | Dependent on choice of operating model (Direct PSPCP vs. Sponsored PSPCPaaS). |
| **BCRA / COELSA** | **Normativa del Sistema Nacional de Pagos (CVU y Alias)** | 22-digit CVU structure (8-digit institution code + 14-digit account sequence with weighted Modulo-10 check digits). | **MANDATORY** for account identification. | `accounts` | Mathematical Modulo-10 validation; separation between algorithmic CVU generation and formal COELSA activation. | Unit test vectors validating check-digit calculation; COELSA routing directory sync. | Obtaining official 8-digit institution prefix from BCRA/COELSA. |
| **UIF** | **Resolución 200/2024** *(PLA/FT/FP para PSP)* | Risk-Based Approach (EBR); Customer Due Diligence (KYC/KYB); PEP screening; RePET sanctions screening; Suspicious Transaction Reports (ROS). | **MANDATORY.** PSPs are designated reporting entities under Ley 25.246. | `compliance` | Identity verification via valid official document (DNI/CUIT/CUIL); automated batch screening against RePET/PEP lists; risk matrix scoring. | Verified customer files (*legajos digitales*); compliance audit logs; designation of Compliance Officer. | Appointment of Compliance Officer and registration before UIF portal. |
| **AAIP** | **Ley 25.326, Artículo 9** *(Seguridad de los Datos)* | Duty to adopt technical and organizational measures to ensure security and prevent alteration, loss, or unauthorized access to personal data. | **MANDATORY.** Financial data and identity records are confidential personal data. | `infrastructure`, `identity` | Strong encryption at rest and in transit; access control on least privilege; zero PII in application logs; automated key rotation. | Security policy document; database registration before the National Registry of Databases (AAIP). | Filing of database registrations with AAIP. |

---

## 5. Regulatory Distinctions: Obligations by Operating Profile

To avoid conflating responsibilities, the technical architecture explicitly isolates which component fulfills each obligation:

```
+---------------------------------------------------------------------------------------+
|                 Direct PSPCP Model                  |      PSPCP as a Service Model   |
+-----------------------------------------------------+---------------------------------+
| * Responsible for BCRA Apartado 4.1 sight account   | * Outsourced to Sponsor PSPCP   |
| * Directly assigned 8-digit CVU prefix from COELSA  | * Uses Sponsor CVU prefix       |
| * Directly submits regulatory regimes to BCRA       | * Sponsor handles BCRA reporting|
| * Direct Reporting Entity before UIF (Res. 200/24)  | * Joint / Delegated KYC controls|
| * Operates direct COELSA clearing connector         | * Integrates via Sponsor REST API|
+---------------------------------------------------------------------------------------+
```
