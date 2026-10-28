import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthController } from './health.controller.js';
import { FastifyReply } from 'fastify';
import { DatabasePool } from '@spbk/infrastructure';

describe('HealthController', () => {
  let controller: HealthController;
  let mockDbPool: DatabasePool;
  let mockReply: FastifyReply;
  let statusCode = 200;

  beforeEach(() => {
    statusCode = 200;
    mockReply = {
      status: vi.fn((code: number) => {
        statusCode = code;
        return mockReply;
      }),
    } as unknown as FastifyReply;

    mockDbPool = {
      connect: vi.fn(),
      totalCount: 5,
      idleCount: 4,
      waitingCount: 0,
    } as unknown as DatabasePool;

    controller = new HealthController(mockDbPool);
  });

  it('should return status ok without regulatory disclaimer on operational endpoint', () => {
    const res = controller.getHealth();
    expect(res.status).toBe('ok');
    expect(res.platform).toBe('SaintPatrickBK');
    expect(res.version).toBe('0.1.0-alpha');
    // Regulatory disclaimer removed from operational telemetry
    expect((res as Record<string, unknown>)['transparencyDisclaimer']).toBeUndefined();
  });

  it('should return alive on liveness probe', () => {
    expect(controller.getLiveness()).toEqual({ status: 'alive' });
  });

  it('should return ready and 200 when database connectivity succeeds', async () => {
    const mockClient = {
      query: vi.fn().mockResolvedValue({ rows: [{ alive: 1 }] }),
      release: vi.fn(),
    };
    (mockDbPool.connect as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(mockClient);

    const res = await controller.getReadiness(mockReply);

    expect(statusCode).toBe(200);
    expect(res.status).toBe('ready');
    expect(res.database).toBe('connected');
    expect(res.latencyMs).toBeDefined();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it('should return unready and 503 when database connectivity fails', async () => {
    (mockDbPool.connect as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('Connection terminated unexpectedly'),
    );

    const res = await controller.getReadiness(mockReply);

    expect(statusCode).toBe(503);
    expect(res.status).toBe('unready');
    expect(res.database).toBe('disconnected');
    expect(res.error).toBe('Connection terminated unexpectedly');
  });
});
