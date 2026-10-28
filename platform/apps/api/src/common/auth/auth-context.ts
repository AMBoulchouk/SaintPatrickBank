import { AuthenticatedPrincipal } from '@spbk/identity';

export type { AuthenticatedPrincipal };

export interface AuthSubject {
  readonly id: string;
  readonly email?: string;
  readonly roles: readonly string[];
  readonly kycStatus: 'VERIFIED' | 'PENDING' | 'REJECTED';
  readonly sessionId?: string | undefined;
  readonly tokenId?: string | undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthenticatedPrincipal | AuthSubject;
    correlationId?: string;
  }
}
