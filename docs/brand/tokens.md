# Brand Identity and Visual Design Tokens: SaintPatrickBK

**Document Status:** Corrected & Verified Specification  
**Project Working Title:** **SaintPatrickBK** (formerly SaintPatrickBank)  
**Status of Visual Identity Assets:** Proposed identity system subject to formal corporate and trademark review  
**Aesthetic Style:** Financial Dark Mode with Preserved Signature Coral Red Accent  
**Visual Heritage:** Derived directly from the legacy Laravel implementation

---

## 1. Brand Identity and Working Title Clarification

* **Working Project Name:** `SaintPatrickBK`
* **Status:** Working title for technical development.
* **Legal Note:** Under **Article 19 of the Argentine Financial Entities Law (Ley 21.526)**, non-bank fintechs and Payment Service Providers (PSPs) are legally prohibited from utilizing the words *"banco"*, *"banca"*, *"banquero"* or foreign equivalents such as *"Bank"*. Replacing "Bank" with the acronym "BK" eliminates the prohibited term in internal references, but **does not grant automatic immunity from regulatory or trademark challenges**. Final commercial usage requires formal trademark clearance before the INPI and regulatory approval.
* **Graphic Assets Status:** The generated logo and isotype files in `docs/brand/assets/` constitute **preliminary design proposals** designed to guide frontend development and are subject to final stakeholder approval.

---

## 2. Core Color Tokens and Mathematical Contrast Verification

### 2.1. Signature Coral Red (Inherited from Legacy Codebase)
The primary action color is derived from the original view templates (`resources/views/pages/welcome.blade.php`):

| Token Name | HEX | RGB | HSL | Relative Luminance ($L$) |
| :--- | :--- | :--- | :--- | :--- |
| `color-brand-primary` | `#FF2D20` | `rgb(255, 45, 32)` | `hsl(3.5°, 100%, 56.3%)` | **$0.2329$** |
| `color-brand-hover` | `#FF4D40` | `rgb(255, 77, 64)` | `hsl(4.1°, 100%, 62.5%)` | **$0.2745$** |
| `color-brand-darkened` | `#C41C12` | `rgb(196, 28, 18)` | `hsl(3.4°, 83%, 42.0%)` | **$0.1172$** |

### 2.2. Mathematical Contrast Calculations (WCAG 2.1)
Applying the official W3C relative luminance formula:
$$\text{Contrast Ratio} = \frac{L_1 + 0.05}{L_2 + 0.05}$$

1. **`#FF2D20` against Pure Black (`#000000`, $L=0$):**
   $$\text{Ratio} = \frac{0.2329 + 0.05}{0 + 0.05} = \frac{0.2829}{0.05} = \mathbf{5.66 : 1}$$
   * **WCAG 2.1 Status:** **PASSES Level AA** for normal body text ($\ge 4.5:1$) and large text ($\ge 3:1$). Fully compliant on dark fintech canvas.

2. **`#FF2D20` against Pure White (`#FFFFFF`, $L=1.0$):**
   $$\text{Ratio} = \frac{1.0 + 0.05}{0.2329 + 0.05} = \frac{1.05}{0.2829} = \mathbf{3.71 : 1}$$
   * **WCAG 2.1 Status:** **FAILS Level AA for normal body text** ($3.71:1 < 4.5:1$). It only passes for large text ($\ge 18$pt or $\ge 14$pt bold) and non-text UI graphical components ($\ge 3.0:1$).
   * **Mandatory UI Rule:** When rendering brand-colored text on light backgrounds (e.g., printed receipts or account statements), the system **must** use the darkened variant **`#C41C12`** ($\text{Ratio} = 5.81:1$), which safely passes Level AA.

---

## 3. Surface & Canvas Tokens

### 3.1. Dark Theme (Primary Fintech Mode)
* `color-bg-base`: `#000000` (Pure Black Canvas)
* `color-bg-surface-1`: `#09090b` (zinc-950 container surface)
* `color-bg-surface-2`: `#18181b` (zinc-900 card surface)
* `color-bg-surface-3`: `#27272a` (zinc-800 interactive inputs)
* `color-border-subtle`: `rgba(255, 255, 255, 0.08)`
* `color-border-strong`: `rgba(255, 255, 255, 0.18)`

### 3.2. Light Theme (Statements & Optional High-Contrast Mode)
* `color-bg-base`: `#F9FAFB` (gray-50)
* `color-bg-surface-1`: `#FFFFFF`
* `color-bg-surface-2`: `#F3F4F6` (gray-100)
* `color-border-subtle`: `#E5E7EB` (gray-200)

---

## 4. Typography Hierarchy and Tabular Financial Data Rules

* **General Headings & Body:** `Inter`, `Figtree`, system-ui, sans-serif.
* **Financial Figures & Audit Displays:** Tabular Monospace font (`JetBrains Mono`, `Fira Code`, or `font-variant-numeric: tabular-nums`).
* **Design Rule:** Visual complexity must never interfere with financial legibility. Balance figures, transaction lists, and transfer confirmation summaries must remain clean, free of heavy drop shadows or distracting gradients that could obscure amounts or decimal centavos.
