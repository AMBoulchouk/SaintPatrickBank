import * as fs from 'node:fs';
import * as path from 'node:path';
import type { Pool, PoolClient } from 'pg';

export interface MigrationResult {
  readonly filename: string;
  readonly executedAt: Date;
  readonly status: 'APPLIED' | 'FAILED';
  readonly error?: string;
}

/**
 * Executes versioned SQL migrations in sequential order.
 * Designed for PostgreSQL 18 reproducible executions in Testcontainers and CI.
 */
export async function runMigrations(
  poolOrClient: Pool | PoolClient,
  migrationsDir?: string
): Promise<readonly MigrationResult[]> {
  const dir = migrationsDir ?? path.resolve(__dirname, '../../migrations');
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const results: MigrationResult[] = [];

  for (const file of files) {
    const fullPath = path.join(dir, file);
    const sql = fs.readFileSync(fullPath, 'utf8');

    try {
      await poolOrClient.query(sql);
      results.push({
        filename: file,
        executedAt: new Date(),
        status: 'APPLIED',
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      results.push({
        filename: file,
        executedAt: new Date(),
        status: 'FAILED',
        error: errorMsg,
      });
      throw new Error(`Migration ${file} failed: ${errorMsg}`);
    }
  }

  return results;
}
