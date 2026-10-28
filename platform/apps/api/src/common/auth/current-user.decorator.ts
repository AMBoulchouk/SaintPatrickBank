import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthSubject } from './auth-context.js';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthSubject => {
    const request = ctx.switchToHttp().getRequest<FastifyRequest>();
    return request.user as AuthSubject;
  },
);
