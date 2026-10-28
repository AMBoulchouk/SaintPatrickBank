import { describe, it, expect } from 'vitest';
import { loadDatabaseConfig } from '../database-config.js';

describe('loadDatabaseConfig', () => {
  it('should load default local development database configuration', () => {
    const config = loadDatabaseConfig({});

    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(5432);
    expect(config.database).toBe('saintpatrickbk_dev');
    expect(config.user).toBe('spbk_app');
    expect(config.minPoolSize).toBe(2);
    expect(config.maxPoolSize).toBe(10);
    expect(config.ssl).toBe(false);
  });

  it('should parse environment variables properly', () => {
    const customEnv = {
      DB_HOST: '10.0.0.5',
      DB_PORT: '5433',
      DB_NAME: 'saintpatrickbk_custom',
      DB_USER: 'custom_user',
      DB_PASSWORD: 'custom_password',
      DB_POOL_MIN: '4',
      DB_POOL_MAX: '20',
      NODE_ENV: 'production',
    };

    const config = loadDatabaseConfig(customEnv);

    expect(config.host).toBe('10.0.0.5');
    expect(config.port).toBe(5433);
    expect(config.database).toBe('saintpatrickbk_custom');
    expect(config.user).toBe('custom_user');
    expect(config.password).toBe('custom_password');
    expect(config.minPoolSize).toBe(4);
    expect(config.maxPoolSize).toBe(20);
    expect(config.ssl).toBe(true);
  });

  it('should reject invalid port configuration', () => {
    expect(() => loadDatabaseConfig({ DB_PORT: 'not-a-number' })).toThrow('Invalid DB_PORT value');
  });
});
