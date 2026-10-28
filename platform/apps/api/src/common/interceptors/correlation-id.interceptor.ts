import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { randomUUID } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

@Injectable()
export class CorrelationIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();

    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined)?.trim() ||
      randomUUID();

    request.correlationId = correlationId;
    reply.header('X-Correlation-Id', correlationId);

    return next.handle();
  }
}
