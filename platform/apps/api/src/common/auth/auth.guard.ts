import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AuthSubject } from './auth-context.js';

@Injectable()
export class FinancialAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    
    // Extract authenticated subject from trusted headers (gateway / reverse proxy in production)
    const userId = (request.headers['x-user-id'] as string | undefined)?.trim();
    if (!userId) {
      throw new UnauthorizedException('Authentication required. Missing trusted subject identity.');
    }

    const rawRoles = (request.headers['x-user-roles'] as string | undefined) ?? '';
    const roles = rawRoles
      .split(',')
      .map((r) => r.trim())
      .filter((r) => r.length > 0);

    const rawKyc = (request.headers['x-kyc-status'] as string | undefined)?.toUpperCase() ?? 'PENDING';
    const kycStatus = rawKyc === 'VERIFIED' ? 'VERIFIED' : rawKyc === 'REJECTED' ? 'REJECTED' : 'PENDING';

    const subject: AuthSubject = {
      id: userId,
      roles: roles.length > 0 ? roles : ['ROLE_CUSTOMER'],
      kycStatus,
      ...(request.headers['x-session-id'] ? { sessionId: request.headers['x-session-id'] as string } : {}),
    };

    request.user = subject;
    return true;
  }
}
