/**
 * @spbk/compliance - Domain Contracts & Regulatory Types
 * Governed by UIF Resolution 200/2024 and BCRA Risk-Based Controls.
 */

export type UifRiskRating = 'LOW' | 'MEDIUM' | 'HIGH';
export type KycVerificationStatus = 'UNVERIFIED' | 'PENDING_DOCUMENTATION' | 'VERIFIED' | 'REJECTED';

export interface CustomerComplianceProfile {
  readonly customerId: string;
  readonly taxId: string; // CUIT/CUIL
  readonly kycStatus: KycVerificationStatus;
  readonly riskRating: UifRiskRating;
  readonly isPep: boolean;
  readonly repetScreenedAt: string;
}
