/**
 * SaintPatrickBK REST API v1 OpenAPI 3.1 Specification
 * Contract governing payment accounts, balance inquiries, and internal transfers.
 */

export const openApiV1Contract = {
  openapi: '3.1.0',
  info: {
    title: 'SaintPatrickBK Core Financial Gateway API',
    version: '1.0.0',
    description:
      'Official REST API for SaintPatrickBK Payment Service Provider (PSPCP). Operates under BCRA and UIF regulatory frameworks in the Argentine Republic.',
    contact: {
      name: 'SaintPatrickBK Engineering & Compliance',
      email: 'security@saintpatrickbk.com',
    },
  },
  servers: [
    {
      url: '/api/v1',
      description: 'Production / Development Ingress Gateway',
    },
  ],
  security: [
    {
      BearerAuth: [],
    },
  ],
  paths: {
    '/accounts': {
      get: {
        summary: 'List Accounts for Authenticated Subject',
        description: 'Returns all virtual payment accounts belonging to the authenticated customer.',
        operationId: 'listAccounts',
        tags: ['Accounts'],
        responses: {
          '200': {
            description: 'List of payment accounts retrieved successfully.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/PaymentAccount' },
                    },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
        },
      },
    },
    '/accounts/{id}': {
      get: {
        summary: 'Get Account Details by ID',
        description:
          'Retrieves metadata and status of a payment account. Enforces resource-level authorization (the caller must own the account or hold ROLE_ADMIN / ROLE_COMPLIANCE).',
        operationId: 'getAccountById',
        tags: ['Accounts'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'UUID of the payment account',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Account details retrieved successfully.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { $ref: '#/components/schemas/PaymentAccount' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/accounts/{id}/balance': {
      get: {
        summary: 'Get Real-Time Account Balance',
        description:
          'Retrieves the real-time available, cleared, and reserved balances directly from the double-entry ledger. Enforces resource-level authorization.',
        operationId: 'getAccountBalance',
        tags: ['Accounts', 'Balances'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            description: 'UUID of the payment account',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Account balance retrieved successfully.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { $ref: '#/components/schemas/AccountBalance' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/accounts/{id}/transactions': {
      get: {
        summary: 'Get Historical Account Transactions',
        description:
          'Retrieves immutable historical journal movements for the given account with cursor/offset pagination. Enforces resource-level authorization.',
        operationId: 'getAccountTransactions',
        tags: ['Accounts', 'Transactions'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 },
          },
          {
            name: 'offset',
            in: 'query',
            required: false,
            schema: { type: 'integer', default: 0, minimum: 0 },
          },
        ],
        responses: {
          '200': {
            description: 'Transaction history retrieved successfully.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { $ref: '#/components/schemas/PaginatedTransactions' },
                  },
                },
              },
            },
          },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
    },
    '/transfers/internal': {
      post: {
        summary: 'Initiate Internal P2P Transfer (Test Environment / Guarded)',
        description:
          'Executes an internal transfer between two SaintPatrickBK accounts. Enforces Idempotency-Key, resource ownership on source account, verified KYC status, account status (ACTIVE), single transfer limits, and non-negative exact centavo amounts. Monitored and posted through double-entry ledger stored procedure.',
        operationId: 'initiateInternalTransfer',
        tags: ['Transfers'],
        parameters: [
          {
            name: 'Idempotency-Key',
            in: 'header',
            required: true,
            description: 'Unique client-supplied idempotency key (IETF draft compliant)',
            schema: { type: 'string' },
          },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/InternalTransferRequest' },
            },
          },
        },
        responses: {
          '200': {
            description: 'Transfer confirmed and atomically posted to double-entry ledger.',
            headers: {
              'X-Idempotent-Replay': {
                description: 'Present and set to true if response was replayed from a previously confirmed transaction.',
                schema: { type: 'boolean' },
              },
            },
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: { $ref: '#/components/schemas/TransferReceipt' },
                  },
                },
              },
            },
          },
          '400': { $ref: '#/components/responses/BadRequest' },
          '401': { $ref: '#/components/responses/Unauthorized' },
          '403': { $ref: '#/components/responses/Forbidden' },
          '404': { $ref: '#/components/responses/NotFound' },
          '409': { $ref: '#/components/responses/Conflict' },
          '422': { $ref: '#/components/responses/UnprocessableEntity' },
        },
      },
    },
    '/transfers/{id}': {
      get: {
        summary: 'Get Transfer Details',
        description: 'Retrieves status and metadata of a financial transfer operation.',
        operationId: 'getTransferById',
        tags: ['Transfers'],
        parameters: [
          {
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        responses: {
          '200': {
            description: 'Transfer details retrieved.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    data: {
                      type: 'object',
                      properties: {
                        operationId: { type: 'string', format: 'uuid' },
                        status: { type: 'string', example: 'CONFIRMED' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          'Cryptographically signed JSON Web Token (JWT HS256) issued by @spbk/identity. Contains authenticated subject identity, cryptographic signature, issuer, audience, and expiration.',
      },
    },
    schemas: {
      PaymentAccount: {
        type: 'object',
        required: [
          'id',
          'customerId',
          'accountNumber',
          'cvu',
          'alias',
          'currency',
          'status',
          'dailyTransferLimit',
          'singleTransferLimit',
          'createdAt',
          'updatedAt',
        ],
        properties: {
          id: { type: 'string', format: 'uuid' },
          customerId: { type: 'string', format: 'uuid' },
          accountNumber: { type: 'string', example: 'SPBK-0001-2026' },
          cvu: { type: 'string', example: '0000001700000000000123' },
          alias: { type: 'string', example: 'marcos.galperin.spbk' },
          currency: { type: 'string', enum: ['ARS'] },
          status: {
            type: 'string',
            enum: ['PENDING_KYC', 'ACTIVE', 'SUSPENDED', 'BLOCKED', 'CLOSED'],
          },
          dailyTransferLimit: { type: 'string', example: '500000000' },
          singleTransferLimit: { type: 'string', example: '200000000' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      AccountBalance: {
        type: 'object',
        required: [
          'accountId',
          'currency',
          'availableCents',
          'availableFormatted',
          'clearedCents',
          'clearedFormatted',
          'reservedCents',
          'reservedFormatted',
          'asOf',
        ],
        properties: {
          accountId: { type: 'string', format: 'uuid' },
          currency: { type: 'string', example: 'ARS' },
          availableCents: { type: 'string', example: '15000000' },
          availableFormatted: { type: 'string', example: '150000.00' },
          clearedCents: { type: 'string', example: '17000000' },
          clearedFormatted: { type: 'string', example: '170000.00' },
          reservedCents: { type: 'string', example: '2000000' },
          reservedFormatted: { type: 'string', example: '20000.00' },
          asOf: { type: 'string', format: 'date-time' },
        },
      },
      InternalTransferRequest: {
        type: 'object',
        required: [
          'sourceAccountId',
          'destinationIdentifier',
          'amountCents',
          'currency',
          'clientReferenceId',
          'description',
        ],
        properties: {
          sourceAccountId: { type: 'string', format: 'uuid' },
          destinationIdentifier: {
            type: 'string',
            description: 'Destination Payment Account UUID, 22-digit CVU, or Alias',
            example: 'juan.perez.spbk',
          },
          amountCents: {
            type: 'string',
            description: 'Strictly positive integer centavos serialized as string',
            example: '50000',
          },
          currency: { type: 'string', enum: ['ARS'] },
          clientReferenceId: {
            type: 'string',
            description: 'Unique business operation reference for persistent idempotency',
            example: 'TX-2026-10-28-001',
          },
          description: { type: 'string', example: 'Pago por servicios' },
          metadata: { type: 'object', additionalProperties: true },
        },
      },
      TransferReceipt: {
        type: 'object',
        required: [
          'operationId',
          'journalEntryId',
          'clientReferenceId',
          'sourceAccountId',
          'destinationAccountId',
          'amountCents',
          'amountFormatted',
          'currency',
          'status',
          'isIdempotentReplay',
          'postedAt',
        ],
        properties: {
          operationId: { type: 'string', format: 'uuid' },
          journalEntryId: { type: 'string', format: 'uuid' },
          clientReferenceId: { type: 'string' },
          sourceAccountId: { type: 'string', format: 'uuid' },
          destinationAccountId: { type: 'string', format: 'uuid' },
          amountCents: { type: 'string', example: '50000' },
          amountFormatted: { type: 'string', example: '500.00' },
          currency: { type: 'string', example: 'ARS' },
          status: { type: 'string', example: 'CONFIRMED' },
          isIdempotentReplay: { type: 'boolean', example: false },
          postedAt: { type: 'string', format: 'date-time' },
        },
      },
      PaginatedTransactions: {
        type: 'object',
        required: ['items', 'total', 'limit', 'offset'],
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', format: 'uuid' },
                entryNumber: { type: 'integer' },
                direction: { type: 'string', enum: ['DEBIT', 'CREDIT'] },
                amountCents: { type: 'string' },
                amountFormatted: { type: 'string' },
                currency: { type: 'string' },
                description: { type: 'string' },
                postedAt: { type: 'string', format: 'date-time' },
              },
            },
          },
          total: { type: 'integer' },
          limit: { type: 'integer' },
          offset: { type: 'integer' },
        },
      },
      ProblemDetails: {
        type: 'object',
        description: 'RFC 9457 Problem Details object (standard for HTTP error responses, superseding RFC 7807)',
        required: ['type', 'title', 'status', 'detail', 'code', 'instance', 'correlationId', 'timestamp'],
        properties: {
          type: { type: 'string', format: 'uri' },
          title: { type: 'string' },
          status: { type: 'integer' },
          detail: { type: 'string' },
          code: { type: 'string' },
          instance: { type: 'string' },
          correlationId: { type: 'string' },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
    },
    responses: {
      BadRequest: {
        description: 'Bad Request - Validation or parameter format error',
        content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } } },
      },
      Unauthorized: {
        description: 'Unauthorized - Missing or invalid credentials',
        content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } } },
      },
      Forbidden: {
        description: 'Forbidden - Insufficient permissions or unverified KYC status',
        content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } } },
      },
      NotFound: {
        description: 'Not Found - Resource does not exist',
        content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } } },
      },
      Conflict: {
        description: 'Conflict - Idempotency conflict with differing payload parameters',
        content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } } },
      },
      UnprocessableEntity: {
        description: 'Unprocessable Entity - Financial business rule violation (e.g., INSUFFICIENT_FUNDS, ACCOUNT_INACTIVE)',
        content: { 'application/problem+json': { schema: { $ref: '#/components/schemas/ProblemDetails' } } },
      },
    },
  },
};
