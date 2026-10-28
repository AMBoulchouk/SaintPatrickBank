# SaintPatrickBK Design System & UI/UX Modernization Specification

**Document Status:** Corrected & Verified Specification  
**Platform Scope:** SaintPatrickBK (Mobile Wallet & Backoffice Console)  
**Standard:** WCAG 2.1 Level AA Accessibility | Mobile-First Responsive Architecture  
**Status of Visual Assets:** Preliminary design proposals subject to formal corporate and trademark review

---

## 1. Brand Identity & Heritage

SaintPatrickBK transforms an early educational prototype into an institutional-grade fintech product. To protect existing visual recognition while aligning with regulatory standards:

* **Working Project Name:** **SaintPatrickBK** (an internal working name replacing the legacy denomination *SaintPatrickBank* to eliminate the term prohibited by **Article 19 of Law 21.526**). Commercial rollout remains subject to trademark registration and regulatory clearance.
* **Corporate Primary Accent:** **Vibrant Coral Red (`#FF2D20`)**, inherited directly from the original Laravel views.
* **Canvas:** Dark Mode by default (`#000000` / `#09090b` / `#18181b`), evoking institutional security, precision, and modern financial sophistication.

---

## 2. Color Palette & Exact Mathematical Contrast (WCAG 2.1)

Applying the W3C relative luminance formula:
$$\text{Contrast Ratio} = \frac{L_1 + 0.05}{L_2 + 0.05}$$

| Color Role | Token Name | HEX | RGB | Relative Luminance ($L$) | Contrast vs. Black (`#000000`) | Contrast vs. White (`#FFFFFF`) | WCAG 2.1 AA Compliance Rating |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Brand Accent** | `--spbk-brand-primary` | `#FF2D20` | `255, 45, 32` | $0.2329$ | **5.66 : 1** | **3.71 : 1** | **Pass on Black** (Normal & Large Text). **Fail on White** for normal text (Passes only for Large Text $\ge 18$pt). |
| **Darkened Text Variant**| `--spbk-brand-text-light`| `#C41C12` | `196, 28, 18` | $0.1172$ | $3.34 : 1$ | **5.81 : 1** | **Pass on White** (Normal Text $\ge 4.5:1$). Used for text on light backgrounds. |
| **Brand Hover** | `--spbk-brand-hover` | `#FF4D40` | `255, 77, 64` | $0.2745$ | **6.49 : 1** | $3.24 : 1$ | **Pass on Black** for interactive components. |
| **Dark Canvas** | `--spbk-bg-base` | `#000000` | `0, 0, 0` | $0.0000$ | Baseline | $21.0 : 1$ | Canvas root. |
| **Elevated Surface 1** | `--spbk-bg-surface-1` | `#09090b` | `9, 9, 11` | $0.0031$ | N/A | $19.8 : 1$ | Container background. |
| **Elevated Surface 2** | `--spbk-bg-surface-2` | `#18181b` | `24, 24, 27` | $0.0102$ | N/A | $17.4 : 1$ | Card and modal surface. |
| **Text Primary (Dark)** | `--spbk-text-primary` | `#FFFFFF` | `255, 255, 255` | $1.0000$ | **21.0 : 1** | Baseline | **Pass AAA** for text on dark backgrounds. |
| **Text Muted (Dark)** | `--spbk-text-secondary`| `#A1A1AA` | `161, 161, 170` | $0.3541$ | **8.08 : 1** | $2.59 : 1$ | **Pass AAA** for supporting labels on dark backgrounds. |

---

## 3. Financial UX Principles: Clarity Over Complexity

Visual complexity must **never** compromise financial legibility, balance transparency, or transfer confirmations:

1. **Tabular Numerics Rule:** All balances, transaction amounts, and CVU/CUIT numbers must render with `tabular-nums` monospace alignment (`JetBrains Mono` or font-variant-numeric: tabular-nums) to prevent horizontal jitter during real-time balance ticks.
2. **Zero Ambiguity in Amounts:** Decimal centavos are explicitly styled with visual consistency. No ambiguous rounding.
3. **Mandatory Regulatory Transparency Footer (T.O. PSP 4.2):**
   * The legal legend stating that payment accounts are not bank deposits must be permanently and legibly rendered in the application footer and statement receipts:
   > *"Los fondos depositados en cuentas de pago no constituyen depósitos en una entidad financiera, ni cuentan con ninguna de las garantías que los depósitos tienen de acuerdo con la legislación y reglamentación aplicables en materia de depósitos en entidades financieras."*
4. **Friction-Appropriate Confirmation (BCRA Com. "A" 7463 & "A" 8398):**
   * Transfer confirmations present counterparty name, CUIT/CUIL, destination institution, and amount with explicit zero-ambiguity review before cryptographic signing or biometric challenge.

---

## 4. Reusable Component Primitives (Cross-Platform)

Design tokens defined in `design-tokens.css` and `tokens.json` govern both the **Customer Mobile/Web Wallet** and the **Backoffice Operations Console**:

* **`Button` Component:** Primary (Coral Red `#FF2D20`), Secondary (Dark Zinc `#27272a`), Danger (`#EF4444` subtle), and Ghost variants.
* **`BalanceCard` Component:** High-contrast display with instant privacy toggle (`$ •••••••• ARS`) and clear separation between `Available` and `In-Flight Reserved` balances.
* **`TransactionRow` Component:** Directional icon, timestamp, counterparty, formatted monospace amount, and explicit status pill (`COMPLETED`, `PENDING`, `REJECTED`).
* **`CVUCopyField` Component:** Monospace 22-digit field with structured separation (`00000031 • 00012345678901`) and tactile copy feedback.
* **`BackofficeGrid` Component:** High-density, audit-ready data grid for operations, compliance officer review, and dual-approval (Maker-Checker) workflows.
