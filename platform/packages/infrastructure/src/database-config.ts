/**
 * Database Configuration & Connection Pool Contract
 * Adheres to 12-factor application design with explicit environment validation.
 */

export interface DatabasePoolConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password?: string;
  minPoolSize: number;
  maxPoolSize: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  ssl: boolean;
}

export function loadDatabaseConfig(env: Record<string, string | undefined> = process.env): DatabasePoolConfig {
  const host = env.DB_HOST ?? '127.0.0.1';
  const port = parseInt(env.DB_PORT ?? '5432', 10);
  const database = env.DB_NAME ?? 'saintpatrickbk_dev';
  const user = env.DB_USER ?? 'spbk_app';
  const password = env.DB_PASSWORD;
  const minPoolSize = parseInt(env.DB_POOL_MIN ?? '2', 10);
  const maxPoolSize = parseInt(env.DB_POOL_MAX ?? '10', 10);

  if (isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid DB_PORT value: "${env.DB_PORT}"`);
  }

  return {
    host,
    port,
    database,
    user,
    ...(password ? { password } : {}),
    minPoolSize: Math.max(1, minPoolSize),
    maxPoolSize: Math.max(minPoolSize, maxPoolSize),
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
    ssl: env.NODE_ENV === 'production',
  };
}
