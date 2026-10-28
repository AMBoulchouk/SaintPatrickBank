export interface AuthSubject {
  readonly id: string;
  readonly roles: readonly string[];
  readonly kycStatus: 'VERIFIED' | 'PENDING' | 'REJECTED';
  readonly sessionId?: string | undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthSubject;
    correlationId?: string;
  }
}
