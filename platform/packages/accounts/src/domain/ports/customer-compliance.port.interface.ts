export interface CustomerStatus {
  readonly customerId: string;
  readonly status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'BLOCKED';
  readonly kycStatus: 'PENDING' | 'VERIFIED' | 'REJECTED';
}

export interface CustomerCompliancePort {
  /**
   * Retrieves the live, authoritative customer status from the identity/compliance repository.
   * Defends against stale JWT claims and TOCTOU concurrency race conditions.
   */
  getLiveCustomerStatus(customerId: string): Promise<CustomerStatus | null>;
}
