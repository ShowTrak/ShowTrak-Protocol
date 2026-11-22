// Type-level assertion helpers for the type tests. Nothing in type-tests/ runs:
// `npm run typecheck` compiles it with noEmit, and an assertion that does not
// hold is a compile error naming the line.
//
// The folder and file names deliberately avoid node --test's patterns
// (*.test.*, test-*, a test/ folder): ShowTrak Client runs `node --test` from
// its root, where this repo is checked out as shared/.

/** True only when A and B are the same type (not merely mutually assignable). */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;

/** Fails to compile unless T is true. */
export type Expect<T extends true> = T;

/** Whether A is assignable to B. */
export type Extends<A, B> = [A] extends [B] ? true : false;

/** For each member of the union T, whether it declares the key K. */
export type HasKey<T, K extends PropertyKey> = T extends unknown
  ? K extends keyof T
    ? true
    : false
  : never;
