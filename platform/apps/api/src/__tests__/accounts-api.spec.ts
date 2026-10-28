import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { AccountsController } from '../accounts/accounts.controller.js';
import { TransfersController } from '../accounts/transfers.controller.js';
import {
  GetAccountUseCase,
  ListCustomerAccountsUseCase,
  GetAccountBalanceUseCase,
  GetAccountTransactionsUseCase,
  ExecuteInternalTransferUseCase,
  AccountNotFoundException,
  UnauthorizedAccountAccessException,
  AccountNotActiveException,
  SingleTransferLimitExceededException,
} from '@spbk/accounts';
import { ProblemDetailsExceptionFilter } from '../common/filters/http-exception.filter.js';
import { FinancialAuthGuard } from '../common/auth/auth.guard.js';
import { JwtTokenService, AuthenticatedPrincipal } from '@spbk/identity';
import { ExecutionContext, UnauthorizedException, BadRequestException } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

describe('Accounts & Transfers REST Controllers (NestJS 11 + Fastify)', () => {
  let accountsController: AccountsController;
  let transfersController: TransfersController;

  const mockGetAccountUseCase = { execute: vi.fn() };
  const mockListAccountsUseCase = { execute: vi.fn() };
  const mockGetBalanceUseCase = { execute: vi.fn() };
  const mockGetTransactionsUseCase = { execute: vi.fn() };
  const mockExecuteTransferUseCase = { execute: vi.fn() };

  const testUser = {
    id: '11111111-1111-1111-1111-111111111111',
    roles: ['ROLE_CUSTOMER'],
    kycStatus: 'VERIFIED' as const,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    accountsController = new AccountsController(
      mockGetAccountUseCase as unknown as GetAccountUseCase,
      mockListAccountsUseCase as unknown as ListCustomerAccountsUseCase,
      mockGetBalanceUseCase as unknown as GetAccountBalanceUseCase,
      mockGetTransactionsUseCase as unknown as GetAccountTransactionsUseCase,
    );

    transfersController = new TransfersController(
      mockExecuteTransferUseCase as unknown as ExecuteInternalTransferUseCase,
    );
  });

  // ---------------------------------------------------------------------------
  // 1. FinancialAuthGuard Unit Tests (Cryptographic Token Verification)
  // ---------------------------------------------------------------------------
  describe('FinancialAuthGuard', () => {
    const tokenService = new JwtTokenService({
      secretKey: 'test_financial_vault_secret_key_minimum_32_chars!',
    });
    const guard = new FinancialAuthGuard(tokenService);

    it('should reject spoofing attempts via X-User-Id, X-User-Roles, or X-Kyc-Status', async () => {
      const mockRequest = {
        headers: {
          'x-user-id': 'user-123',
          'x-user-roles': 'ROLE_ADMIN',
          'x-kyc-status': 'VERIFIED',
        },
      } as unknown as FastifyRequest;

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        /Identity spoofing rejected/,
      );
    });

    it('should throw UnauthorizedException when Bearer token is missing', async () => {
      const mockRequest = {
        headers: {},
      } as unknown as FastifyRequest;

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      await expect(guard.canActivate(mockContext)).rejects.toThrow(
        /Missing Bearer token/,
      );
    });

    it('should allow access and set principal when valid cryptographic Bearer token is provided', async () => {
      const principal = new AuthenticatedPrincipal({
        id: 'user-123',
        email: 'user@saintpatrickbk.com',
        roles: ['ROLE_CUSTOMER'],
        kycStatus: 'VERIFIED',
      });
      const validToken = await tokenService.createAccessToken(principal);

      const mockRequest = {
        headers: {
          authorization: `Bearer ${validToken}`,
        },
      } as unknown as FastifyRequest;

      const mockContext = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
        }),
      } as unknown as ExecutionContext;

      const result = await guard.canActivate(mockContext);
      expect(result).toBe(true);
      expect(mockRequest.user?.id).toBe('user-123');
      expect(mockRequest.user?.kycStatus).toBe('VERIFIED');
    });
  });

  // ---------------------------------------------------------------------------
  // 2. AccountsController Tests
  // ---------------------------------------------------------------------------
  describe('AccountsController', () => {
    it('should list accounts for current authenticated subject', async () => {
      mockListAccountsUseCase.execute.mockResolvedValue([
        {
          id: 'acc-1',
          customerId: testUser.id,
          accountNumber: 'SPBK-001',
          cvu: '0000001700000000000111',
          alias: 'alice.spbk',
          currency: 'ARS',
          status: 'ACTIVE',
        },
      ]);

      const res = await accountsController.listAccounts(testUser);
      expect(res.data.length).toBe(1);
      expect(res.data[0]?.alias).toBe('alice.spbk');
      expect(mockListAccountsUseCase.execute).toHaveBeenCalledWith({
        subjectId: testUser.id,
        roles: testUser.roles,
        kycStatus: testUser.kycStatus,
      });
    });

    it('should retrieve single account details', async () => {
      mockGetAccountUseCase.execute.mockResolvedValue({
        id: 'acc-1',
        customerId: testUser.id,
        alias: 'alice.spbk',
        status: 'ACTIVE',
      });

      const res = await accountsController.getAccount('acc-1', testUser);
      expect(res.data.id).toBe('acc-1');
      expect(mockGetAccountUseCase.execute).toHaveBeenCalledWith('acc-1', {
        subjectId: testUser.id,
        roles: testUser.roles,
        kycStatus: testUser.kycStatus,
      });
    });

    it('should retrieve real-time account balance', async () => {
      mockGetBalanceUseCase.execute.mockResolvedValue({
        accountId: 'acc-1',
        currency: 'ARS',
        availableCents: '5000000',
        availableFormatted: '50000.00',
        clearedCents: '5000000',
        clearedFormatted: '50000.00',
        reservedCents: '0',
        reservedFormatted: '0.00',
        asOf: '2026-10-28T00:00:00.000Z',
      });

      const res = await accountsController.getBalance('acc-1', testUser);
      expect(res.data.availableFormatted).toBe('50000.00');
      expect(res.data.currency).toBe('ARS');
    });

    it('should retrieve paginated transactions', async () => {
      mockGetTransactionsUseCase.execute.mockResolvedValue({
        items: [
          {
            id: 'line-1',
            entryNumber: 1,
            direction: 'CREDIT',
            amountCents: '5000000',
            amountFormatted: '50000.00',
            currency: 'ARS',
            description: 'Depósito inicial',
            postedAt: '2026-10-28T00:00:00.000Z',
          },
        ],
        total: 1,
        limit: 20,
        offset: 0,
      });

      const res = await accountsController.getTransactions('acc-1', '20', '0', testUser);
      expect(res.data.total).toBe(1);
      expect(res.data.items[0]?.direction).toBe('CREDIT');
    });
  });

  // ---------------------------------------------------------------------------
  // 3. TransfersController Tests
  // ---------------------------------------------------------------------------
  describe('TransfersController', () => {
    it('should reject request missing Idempotency-Key header', async () => {
      const mockReply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as unknown as FastifyReply;

      await expect(
        transfersController.initiateInternalTransfer(
          {
            sourceAccountId: 'acc-1',
            destinationIdentifier: 'bob.spbk',
            amountCents: '50000',
            currency: 'ARS',
            clientReferenceId: 'TX-001',
            description: 'Test',
          },
          undefined, // Missing Idempotency-Key!
          testUser,
          mockReply,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject request with non-positive amountCents', async () => {
      const mockReply = {
        status: vi.fn().mockReturnThis(),
        send: vi.fn(),
      } as unknown as FastifyReply;

      await expect(
        transfersController.initiateInternalTransfer(
          {
            sourceAccountId: 'acc-1',
            destinationIdentifier: 'bob.spbk',
            amountCents: '0', // Zero cents!
            currency: 'ARS',
            clientReferenceId: 'TX-001',
            description: 'Test',
          },
          'KEY-123',
          testUser,
          mockReply,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should execute transfer and set X-Idempotent-Replay header if replayed', async () => {
      mockExecuteTransferUseCase.execute.mockResolvedValue({
        operationId: 'op-1',
        journalEntryId: 'entry-1',
        clientReferenceId: 'TX-001',
        sourceAccountId: 'acc-1',
        destinationAccountId: 'acc-2',
        amountCents: '50000',
        amountFormatted: '500.00',
        currency: 'ARS',
        status: 'CONFIRMED',
        isIdempotentReplay: true,
        postedAt: '2026-10-28T00:00:00.000Z',
      });

      const headerMock = vi.fn();
      const sendMock = vi.fn();
      const statusMock = vi.fn().mockReturnValue({ send: sendMock });

      const mockReply = {
        header: headerMock,
        status: statusMock,
        send: sendMock,
      } as unknown as FastifyReply;

      await transfersController.initiateInternalTransfer(
        {
          sourceAccountId: 'acc-1',
          destinationIdentifier: 'bob.spbk',
          amountCents: '50000',
          currency: 'ARS',
          clientReferenceId: 'TX-001',
          description: 'Payment',
        },
        'KEY-123',
        testUser,
        mockReply,
      );

      expect(headerMock).toHaveBeenCalledWith('X-Idempotent-Replay', 'true');
      expect(statusMock).toHaveBeenCalledWith(200);
      expect(sendMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: 'CONFIRMED',
            isIdempotentReplay: true,
          }),
        }),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // 4. ProblemDetailsExceptionFilter Tests
  // ---------------------------------------------------------------------------
  describe('ProblemDetailsExceptionFilter', () => {
    const filter = new ProblemDetailsExceptionFilter();

    const createMockHost = (url = '/api/v1/accounts/123') => {
      const sentPayload: { status?: number; data?: unknown; headers: Record<string, string> } = {
        headers: {},
      };
      const mockReply = {
        status: (code: number) => {
          sentPayload.status = code;
          return mockReply;
        },
        header: (k: string, v: string) => {
          sentPayload.headers[k] = v;
          return mockReply;
        },
        send: (body: unknown) => {
          sentPayload.data = body;
        },
      };

      const mockRequest = {
        url,
        correlationId: 'test-corr-id-123',
        headers: {},
      };

      const mockHost = {
        switchToHttp: () => ({
          getRequest: () => mockRequest,
          getResponse: () => mockReply,
        }),
      } as unknown as Parameters<typeof filter.catch>[1];

      return { mockHost, sentPayload };
    };

    it('should format AccountNotFoundException as RFC 9457 404', () => {
      const { mockHost, sentPayload } = createMockHost();
      filter.catch(new AccountNotFoundException('acc-999'), mockHost);

      expect(sentPayload.status).toBe(404);
      expect(sentPayload.headers['Content-Type']).toBe('application/problem+json');
      expect(sentPayload.data).toEqual(
        expect.objectContaining({
          status: 404,
          code: 'ACCOUNT_NOT_FOUND',
          correlationId: 'test-corr-id-123',
        }),
      );
    });

    it('should format UnauthorizedAccountAccessException as RFC 9457 403', () => {
      const { mockHost, sentPayload } = createMockHost();
      filter.catch(new UnauthorizedAccountAccessException('acc-bob', 'cust-alice'), mockHost);

      expect(sentPayload.status).toBe(403);
      expect(sentPayload.data).toEqual(
        expect.objectContaining({
          status: 403,
          code: 'FORBIDDEN_ACCOUNT_ACCESS',
        }),
      );
    });

    it('should format AccountNotActiveException as RFC 9457 422', () => {
      const { mockHost, sentPayload } = createMockHost();
      filter.catch(new AccountNotActiveException('acc-susp', 'SUSPENDED'), mockHost);

      expect(sentPayload.status).toBe(422);
      expect(sentPayload.data).toEqual(
        expect.objectContaining({
          status: 422,
          code: 'ACCOUNT_NOT_ACTIVE',
        }),
      );
    });

    it('should format SingleTransferLimitExceededException as RFC 9457 422', () => {
      const { mockHost, sentPayload } = createMockHost();
      filter.catch(new SingleTransferLimitExceededException(500000000n, 200000000n), mockHost);

      expect(sentPayload.status).toBe(422);
      expect(sentPayload.data).toEqual(
        expect.objectContaining({
          status: 422,
          code: 'TRANSFER_LIMIT_EXCEEDED',
        }),
      );
    });

    it('should strictly sanitize raw PostgreSQL / SQL syntax errors and NEVER leak SQL text', () => {
      const { mockHost, sentPayload } = createMockHost();
      const rawPgError = new Error(
        'syntax error at or near "SELECT * FROM ledger.account_balances WHERE secret_col = \'leak\'"',
      );

      filter.catch(rawPgError, mockHost);

      expect(sentPayload.status).toBe(500);
      expect(sentPayload.data).toEqual(
        expect.objectContaining({
          status: 500,
          code: 'DATABASE_PROCESSING_ERROR',
          title: 'Internal Processing Error',
          detail: 'A technical error occurred while processing the financial transaction. Please retry or contact support.',
        }),
      );
      // Verify NO SQL or table names leaked in the response detail
      expect(JSON.stringify(sentPayload.data)).not.toContain('ledger.account_balances');
      expect(JSON.stringify(sentPayload.data)).not.toContain('secret_col');
    });
  });
});
