import type { Pool, PoolClient } from 'pg';
import {
  CustomerStatusPort,
  CustomerFinancialStatus,
} from '../../domain/ports/customer-status.port.interface.js';
import {
  KycVerificationStatus,
  UserLifecycleStatus,
} from '../../domain/value-objects/authenticated-principal.vo.js';

export class PgCustomerStatusAdapter implements CustomerStatusPort {
  constructor(private readonly pool: Pool) {}

  async getLiveCustomerStatus(
    customerId: string,
    options?: { lockRow?: boolean; client?: unknown }
  ): Promise<CustomerFinancialStatus | null> {
    const dbClient = (options?.client as PoolClient | undefined) ?? this.pool;
    const lockClause = options?.lockRow ? ' FOR UPDATE' : '';

    const query = `
      SELECT id, status, kyc_status 
      FROM identity.users 
      WHERE id = $1${lockClause}
    `;

    const res = await dbClient.query<{
      id: string;
      status: string;
      kyc_status: string;
    }>(query, [customerId]);

    const row = res.rows[0];
    if (!row) {
      return null;
    }

    const status = row.status as UserLifecycleStatus;
    const kycStatus = row.kyc_status as KycVerificationStatus;
    const canOperateFinancially = status === 'ACTIVE' && kycStatus === 'VERIFIED';

    return {
      customerId: row.id,
      status,
      kycStatus,
      canOperateFinancially,
    };
  }
}
