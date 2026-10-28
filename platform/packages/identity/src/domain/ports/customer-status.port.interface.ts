import {
  KycVerificationStatus,
  UserLifecycleStatus,
} from '../value-objects/authenticated-principal.vo.js';

export interface CustomerFinancialStatus {
  readonly customerId: string;
  readonly status: UserLifecycleStatus;
  readonly kycStatus: KycVerificationStatus;
  readonly canOperateFinancially: boolean;
}

export interface CustomerStatusPort {
  /**
   * Queries the live, authoritative customer status from PostgreSQL.
   * If lockRow is true, executes within the given client transaction using SELECT ... FOR UPDATE
   * to guarantee prevention of Time-of-Check to Time-of-Use (TOCTOU) concurrency bugs.
   */
  getLiveCustomerStatus(
    customerId: string,
    options?: { lockRow?: boolean; client?: unknown }
  ): Promise<CustomerFinancialStatus | null>;
}
