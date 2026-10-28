import { hash, verify } from '@node-rs/argon2';

export interface Argon2Options {
  readonly memoryCost?: number; // In KiB (default: 19456 = 19 MiB per OWASP)
  readonly timeCost?: number; // Iterations (default: 2)
  readonly outputLen?: number; // 32 bytes
  readonly parallelism?: number; // 1 thread
}

export class PasswordHash {
  private readonly _hash: string;

  private constructor(hashString: string) {
    if (!hashString.startsWith('$argon2id$')) {
      throw new Error('Password hash must be in valid Argon2id format ($argon2id$...)');
    }
    this._hash = hashString;
  }

  get value(): string {
    return this._hash;
  }

  /**
   * Reconstructs an existing validated Argon2id hash from database storage.
   */
  static fromExisting(hashString: string): PasswordHash {
    return new PasswordHash(hashString);
  }

  /**
   * Hashes a plaintext password using Argon2id with OWASP recommended parameters.
   */
  static async create(
    plainText: string,
    options?: Argon2Options,
  ): Promise<PasswordHash> {
    if (!plainText || plainText.length < 8) {
      throw new Error('Password must be at least 8 characters in length');
    }
    if (plainText.length > 128) {
      throw new Error('Password exceeds maximum allowed length of 128 characters');
    }

    const hashed = await hash(plainText, {
      memoryCost: options?.memoryCost ?? 19456,
      timeCost: options?.timeCost ?? 2,
      outputLen: options?.outputLen ?? 32,
      parallelism: options?.parallelism ?? 1,
    });

    return new PasswordHash(hashed);
  }

  /**
   * Verifies a plaintext password against the encapsulated Argon2id hash using constant-time comparison.
   */
  async verify(plainText: string): Promise<boolean> {
    if (!plainText) {
      return false;
    }
    try {
      return await verify(this._hash, plainText);
    } catch {
      return false;
    }
  }

  toString(): string {
    return '[PROTECTED_HASH]';
  }
}
