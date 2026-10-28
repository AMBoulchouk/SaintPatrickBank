import { CVU } from '../value-objects/cvu.js';

export interface CvuAllocationRequest {
  readonly customerId: string;
  readonly internalAccountNumber: string;
  readonly customerTaxId: string;
  readonly accountCurrency: string;
}

export interface CvuResolutionDetails {
  readonly cvu: CVU;
  readonly pspCode: string;
  readonly pspName: string;
  readonly holderName: string;
  readonly holderTaxId: string;
  readonly status: 'ACTIVE' | 'BLOCKED' | 'CANCELLED';
}

/**
 * Port: ICvuAssignmentProvider
 * Contract for future external/regulatory COELSA / Bank provider CVU allocation.
 *
 * CRITICAL ARCHITECTURAL DISTINCTIONS:
 * 1. CVU Mathematical Validation (Local):
 *    - Validates 22-digit formatting and official COELSA weighted Modulo 10 check digits (D1 and D2).
 *    - Performed locally in-process without network calls.
 * 2. Synthetic Test CVU Generation (Sandbox Only):
 *    - Uses `CVU.createForTesting()` to produce mathematically correct check digits for unit/integration tests.
 *    - strictly segregated to testing environments; never routed to external clearing houses.
 * 3. Operational CVU Assignment (Regulated External Authority):
 *    - Requires official BCRA PSP registration number (3 digits).
 *    - Requires bilateral or direct COELSA interconnection contracts.
 *    - Enforces real-time registration in the National CVU Directory (administración, altas, bajas, consultas).
 *    - Must NOT be generated locally or simulated in production environments.
 */
export interface ICvuAssignmentProvider {
  /**
   * Requests the official allocation and registration of a new CVU in the COELSA national directory.
   */
  allocateCvu(request: CvuAllocationRequest): Promise<CVU>;

  /**
   * Releases or de-registers an allocated CVU from the national directory (e.g. upon account closure).
   */
  releaseCvu(cvu: CVU, reason: string): Promise<void>;

  /**
   * Resolves routing information and holder identity for any Argentine CVU/CBU.
   */
  resolveCvu(cvu: CVU): Promise<CvuResolutionDetails | null>;
}
