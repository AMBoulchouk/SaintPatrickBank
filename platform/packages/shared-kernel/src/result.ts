/**
 * Functional Result Pattern for Financial Domain Engineering
 * Eliminates unhandled exceptions in critical business operations.
 */

export type Result<T, E> = Ok<T, E> | Err<T, E>;

export class Ok<T, E> {
  readonly isOk = true;
  readonly isErr = false;

  constructor(readonly value: T) {}

  unwrap(): T {
    return this.value;
  }

  unwrapOr(_defaultValue: T): T {
    return this.value;
  }

  map<U>(fn: (val: T) => U): Result<U, E> {
    return new Ok<U, E>(fn(this.value));
  }

  mapErr<F>(_fn: (err: E) => F): Result<T, F> {
    return new Ok<T, F>(this.value);
  }
}

export class Err<T, E> {
  readonly isOk = false;
  readonly isErr = true;

  constructor(readonly error: E) {}

  unwrap(): T {
    throw new Error(`Attempted to unwrap an Err: ${String(this.error)}`);
  }

  unwrapOr(defaultValue: T): T {
    return defaultValue;
  }

  map<U>(_fn: (val: T) => U): Result<U, E> {
    return new Err<U, E>(this.error);
  }

  mapErr<F>(fn: (err: E) => F): Result<T, F> {
    return new Err<T, F>(fn(this.error));
  }
}

export const ok = <T, E = never>(value: T): Result<T, E> => new Ok<T, E>(value);
export const err = <T = never, E = unknown>(error: E): Result<T, E> => new Err<T, E>(error);
