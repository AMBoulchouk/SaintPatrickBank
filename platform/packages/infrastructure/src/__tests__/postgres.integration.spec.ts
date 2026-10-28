/**
 * Real PostgreSQL Integration Test using Testcontainers PostgreSqlContainer
 * Verifies live connection pooling, health checks, and transactional rollback against a real PostgreSQL 18 instance.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { createDatabasePool, checkDatabaseHealth, DatabasePool } from '../database.js';

describe('PostgreSQL 18 Integration via Testcontainers', () => {
  let container: StartedPostgreSqlContainer;
  let pool: DatabasePool;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:18-alpine')
      .withDatabase('saintpatrickbk_integration')
      .withUsername('spbk_test_user')
      .withPassword('test_password_123')
      .start();

    pool = createDatabasePool({
      host: container.getHost(),
      port: container.getPort(),
      database: container.getDatabase(),
      user: container.getUsername(),
      password: container.getPassword(),
      minPoolSize: 1,
      maxPoolSize: 5,
      idleTimeoutMillis: 5000,
      connectionTimeoutMillis: 5000,
      ssl: false,
    });
  }, 60000);

  afterAll(async () => {
    if (pool) {
      await pool.end();
    }
    if (container) {
      await container.stop();
    }
  }, 30000);

  it('should report healthy connectivity against real PostgreSQL 18 container', async () => {
    const healthResult = await checkDatabaseHealth(pool);

    expect(healthResult.isOk).toBe(true);
    if (healthResult.isOk) {
      expect(healthResult.value.latencyMs).toBeGreaterThan(0);
      expect(healthResult.value.activeConnections).toBeGreaterThanOrEqual(0);
    }
  });

  it('should query PostgreSQL version and confirm version 18', async () => {
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT version();');
      expect(res.rows[0].version).toContain('PostgreSQL 18');
    } finally {
      client.release();
    }
  });

  it('should guarantee atomic transactional rollback upon error', async () => {
    const client = await pool.connect();
    try {
      await client.query('CREATE TEMPORARY TABLE test_accounts (id INT PRIMARY KEY, balance_cents BIGINT);');
      await client.query('INSERT INTO test_accounts VALUES (1, 10000);');

      // Attempt transaction that fails halfway
      await client.query('BEGIN');
      await client.query('UPDATE test_accounts SET balance_cents = balance_cents - 2000 WHERE id = 1;');

      try {
        // Intentionally trigger check violation / duplicate key failure
        await client.query('INSERT INTO test_accounts VALUES (1, 5000);');
        await client.query('COMMIT');
      } catch {
        await client.query('ROLLBACK');
      }

      // Verify that balance was rolled back to original 10000
      const checkRes = await client.query('SELECT balance_cents FROM test_accounts WHERE id = 1;');
      expect(checkRes.rows[0].balance_cents).toBe('10000');
    } finally {
      client.release();
    }
  });
});
