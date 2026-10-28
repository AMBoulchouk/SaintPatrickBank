/**
 * Database Connection Pool and Health Check Engine
 * Provides resilient, typed connection pooling via pg.Pool.
 */

import pg from 'pg';
import { Result, ok, err } from '@spbk/shared-kernel';
import { DatabasePoolConfig, loadDatabaseConfig } from './database-config.js';

export type DatabasePool = pg.Pool;

export interface DatabaseHealthReport {
  latencyMs: number;
  activeConnections: number;
  idleConnections: number;
  waitingClients: number;
}

export function createDatabasePool(config: DatabasePoolConfig = loadDatabaseConfig()): DatabasePool {
  const pool = new pg.Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    min: config.minPoolSize,
    max: config.maxPoolSize,
    idleTimeoutMillis: config.idleTimeoutMillis,
    connectionTimeoutMillis: config.connectionTimeoutMillis,
    ssl: config.ssl ? { rejectUnauthorized: true } : false,
  });

  return pool;
}

export async function checkDatabaseHealth(pool: DatabasePool): Promise<Result<DatabaseHealthReport, Error>> {
  const start = performance.now();
  try {
    const client = await pool.connect();
    try {
      await client.query('SELECT 1 AS alive;');
      const latencyMs = Math.round((performance.now() - start) * 100) / 100;
      return ok({
        latencyMs,
        activeConnections: pool.totalCount - pool.idleCount,
        idleConnections: pool.idleCount,
        waitingClients: pool.waitingCount,
      });
    } finally {
      client.release();
    }
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
