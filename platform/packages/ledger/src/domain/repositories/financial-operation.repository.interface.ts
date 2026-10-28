import type { FinancialOperation } from '../entities/financial-operation.js';

export interface IFinancialOperationRepository {
  getOperationById(operationId: string): Promise<FinancialOperation | null>;
  getOperationByClientRef(clientRef: string): Promise<FinancialOperation | null>;
}
