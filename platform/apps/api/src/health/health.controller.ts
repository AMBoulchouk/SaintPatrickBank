import { Controller, Get, HttpCode, HttpStatus, Inject, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { checkDatabaseHealth } from '@spbk/infrastructure';
import type { DatabasePool } from '@spbk/infrastructure';

export interface HealthInfoResponse {
  status: 'ok';
  platform: string;
  version: string;
  environment: string;
  timestamp: string;
  uptimeSeconds: number;
}

export interface LivenessResponse {
  status: 'alive';
}

export interface ReadinessResponse {
  status: 'ready' | 'unready';
  database: 'connected' | 'disconnected';
  latencyMs?: number;
  error?: string;
}

@Controller('health')
export class HealthController {
  private readonly startTime = Date.now();

  constructor(
    @Inject('DATABASE_POOL')
    private readonly dbPool: DatabasePool,
  ) {}

  /**
   * General operational status and telemetry.
   * Note: Regulatory disclosures (T.O. PSP 4.2) are intentionally segregated from technical
   * healthchecks and assigned to user-facing UI layouts, receipts, and public API headers.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  getHealth(): HealthInfoResponse {
    return {
      status: 'ok',
      platform: 'SaintPatrickBK',
      version: '0.1.0-alpha',
      environment: process.env.NODE_ENV ?? 'development',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor((Date.now() - this.startTime) / 1000),
    };
  }

  /**
   * Kubernetes / Container liveness probe.
   * Returns 200 as long as the process event loop is responsive.
   */
  @Get('live')
  @HttpCode(HttpStatus.OK)
  getLiveness(): LivenessResponse {
    return { status: 'alive' };
  }

  /**
   * Readiness probe.
   * Performs an active query against PostgreSQL to guarantee downstream traffic readiness.
   * Returns HTTP 200 when database connectivity is verified, or HTTP 503 upon connection failure.
   */
  @Get('ready')
  async getReadiness(@Res({ passthrough: true }) reply: FastifyReply): Promise<ReadinessResponse> {
    const healthResult = await checkDatabaseHealth(this.dbPool);

    if (healthResult.isOk) {
      reply.status(HttpStatus.OK);
      return {
        status: 'ready',
        database: 'connected',
        latencyMs: healthResult.value.latencyMs,
      };
    }

    reply.status(HttpStatus.SERVICE_UNAVAILABLE);
    return {
      status: 'unready',
      database: 'disconnected',
      error: healthResult.error.message,
    };
  }
}
