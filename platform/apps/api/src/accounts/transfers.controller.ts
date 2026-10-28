import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Headers,
  UseGuards,
  UseInterceptors,
  BadRequestException,
  Res,
  HttpStatus,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { FinancialAuthGuard } from '../common/auth/auth.guard.js';
import { CurrentUser } from '../common/auth/current-user.decorator.js';
import type { AuthSubject } from '../common/auth/auth-context.js';
import { CorrelationIdInterceptor } from '../common/interceptors/correlation-id.interceptor.js';
import { ExecuteInternalTransferUseCase } from '@spbk/accounts';
import { Money } from '@spbk/shared-kernel';
import type { InternalTransferRequestDto } from './dto/transfer-request.dto.js';

@Controller('api/v1/transfers')
@UseGuards(FinancialAuthGuard)
@UseInterceptors(CorrelationIdInterceptor)
export class TransfersController {
  constructor(
    private readonly executeInternalTransferUseCase: ExecuteInternalTransferUseCase,
  ) {}

  @Post('internal')
  async initiateInternalTransfer(
    @Body() body: InternalTransferRequestDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: AuthSubject,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new BadRequestException('Mandatory header "Idempotency-Key" is missing.');
    }

    if (!body.clientReferenceId || body.clientReferenceId.trim().length === 0) {
      throw new BadRequestException('Mandatory field "clientReferenceId" is missing.');
    }

    if (!body.sourceAccountId) {
      throw new BadRequestException('Mandatory field "sourceAccountId" is missing.');
    }

    if (!body.destinationIdentifier) {
      throw new BadRequestException('Mandatory field "destinationIdentifier" is missing.');
    }

    if (!body.amountCents || !/^\d+$/.test(body.amountCents.trim())) {
      throw new BadRequestException('Invalid "amountCents": must be a strictly positive integer string of centavos.');
    }

    const amount = Money.fromCents(BigInt(body.amountCents.trim()), body.currency ?? 'ARS');
    if (!amount.isPositive()) {
      throw new BadRequestException('Transfer amount must be strictly positive.');
    }

    const receipt = await this.executeInternalTransferUseCase.execute(
      {
        sourceAccountId: body.sourceAccountId,
        destinationIdentifier: body.destinationIdentifier,
        amount,
        clientReferenceId: body.clientReferenceId,
        idempotencyKey: idempotencyKey.trim(),
        description: body.description ?? 'Transferencia interna SaintPatrickBK',
        metadata: body.metadata,
      },
      {
        subjectId: user.id,
        roles: user.roles,
        kycStatus: user.kycStatus,
      },
    );

    if (receipt.isIdempotentReplay) {
      reply.header('X-Idempotent-Replay', 'true');
    }

    reply.status(HttpStatus.OK).send({ data: receipt });
  }

  @Get(':id')
  async getTransfer(
    @Param('id') operationId: string,
    @CurrentUser() user: AuthSubject,
  ): Promise<{ data: { operationId: string; status: string; customerId: string } }> {
    // Basic verification / status query endpoint
    return {
      data: {
        operationId,
        status: 'CONFIRMED',
        customerId: user.id,
      },
    };
  }
}
