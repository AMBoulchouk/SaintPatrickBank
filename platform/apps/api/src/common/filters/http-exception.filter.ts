import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { StructuredLogger } from '@spbk/infrastructure';

/**
 * RFC 9457 Problem Details Exception Filter
 * Implements "Problem Details for HTTP APIs" (RFC 9457, June 2023, obsoleting RFC 7807).
 *
 * Guarantees:
 * - Content-Type: application/problem+json
 * - Standard RFC 9457 members: type, title, status, detail, instance
 * - Extension members: code, correlationId, timestamp
 * - Strict information hiding: Infrastructure and SQL errors are sanitized; sensitive internal
 *   details (stack traces, SQL text, table/column names) are NEVER leaked to HTTP clients.
 */
@Catch()
export class ProblemDetailsExceptionFilter implements ExceptionFilter {
  private readonly logger = new StructuredLogger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const correlationId = request.correlationId || (request.headers['x-correlation-id'] as string) || 'unknown';
    const timestamp = new Date().toISOString();
    const instance = request.url;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let title = 'Internal Server Error';
    let detail = 'An unexpected internal error occurred.';
    let code = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      title = exception.name;
      code = `HTTP_${status}`;
      if (typeof res === 'string') {
        detail = res;
      } else if (typeof res === 'object' && res !== null) {
        detail = (res as { message?: string | string[] }).message
          ? Array.isArray((res as { message?: string | string[] }).message)
            ? ((res as { message: string[] }).message).join(', ')
            : String((res as { message?: string }).message)
          : exception.message;
      }
    } else if (exception instanceof Error) {
      const errName = exception.name;
      const message = exception.message;

      // Domain-specific mapping
      if (errName === 'AccountNotFoundException') {
        status = HttpStatus.NOT_FOUND;
        title = 'Account Not Found';
        detail = message;
        code = 'ACCOUNT_NOT_FOUND';
      } else if (errName === 'UnauthorizedAccountAccessException') {
        status = HttpStatus.FORBIDDEN;
        title = 'Forbidden';
        detail = message;
        code = 'FORBIDDEN_ACCOUNT_ACCESS';
      } else if (errName === 'InsufficientKycLevelException') {
        status = HttpStatus.FORBIDDEN;
        title = 'Insufficient KYC Verification';
        detail = message;
        code = 'INSUFFICIENT_KYC_LEVEL';
      } else if (errName === 'AccountNotActiveException') {
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        title = 'Account Inactive';
        detail = message;
        code = 'ACCOUNT_NOT_ACTIVE';
      } else if (errName === 'AccountCannotReceiveException') {
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        title = 'Destination Account Cannot Receive Transfers';
        detail = message;
        code = 'ACCOUNT_CANNOT_RECEIVE';
      } else if (errName === 'SingleTransferLimitExceededException') {
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        title = 'Transfer Limit Exceeded';
        detail = message;
        code = 'TRANSFER_LIMIT_EXCEEDED';
      } else if (errName === 'CurrencyMismatchException') {
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        title = 'Currency Mismatch';
        detail = message;
        code = 'CURRENCY_MISMATCH';
      } else if (errName === 'InvalidTransferAmountException') {
        status = HttpStatus.BAD_REQUEST;
        title = 'Invalid Transfer Amount';
        detail = message;
        code = 'INVALID_AMOUNT';
      } else if (message.includes('INSUFFICIENT_FUNDS')) {
        status = HttpStatus.UNPROCESSABLE_ENTITY;
        title = 'Insufficient Funds';
        detail = 'Available balance is insufficient to complete the requested transfer.';
        code = 'INSUFFICIENT_FUNDS';
      } else if (message.includes('IDEMPOTENCY_CONFLICT')) {
        status = HttpStatus.CONFLICT;
        title = 'Idempotency Conflict';
        detail = 'The client reference ID was previously submitted with differing transaction parameters.';
        code = 'IDEMPOTENCY_CONFLICT';
      } else if (message.includes('Source and destination payment accounts cannot be identical')) {
        status = HttpStatus.BAD_REQUEST;
        title = 'Identical Accounts';
        detail = message;
        code = 'IDENTICAL_ACCOUNTS';
      } else {
        // Infrastructure / PostgreSQL errors: STRICT SANITIZATION
        // NEVER expose SQL text, tables, columns, constraints or stack traces!
        this.logger.error('Unhandled infrastructure exception caught', {
          error: message,
          stack: exception.stack,
          correlationId,
          url: request.url,
        });

        status = HttpStatus.INTERNAL_SERVER_ERROR;
        title = 'Internal Processing Error';
        detail = 'A technical error occurred while processing the financial transaction. Please retry or contact support.';
        code = 'DATABASE_PROCESSING_ERROR';
      }
    }

    const problemDetails = {
      type: `https://api.saintpatrickbk.com/errors/${code.toLowerCase()}`,
      title,
      status,
      detail,
      code,
      instance,
      correlationId,
      timestamp,
    };

    response.status(status).header('Content-Type', 'application/problem+json').send(problemDetails);
  }
}
