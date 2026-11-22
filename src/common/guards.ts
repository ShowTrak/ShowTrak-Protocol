// Type guards for values of unknown type: JSON just parsed, a socket or IPC
// payload, a file read back from disk, a third-party callback's argument.
//
// Array.isArray narrows `unknown` to `any[]`, after which nothing read from the
// array is checked at all. IsArray narrows to `unknown[]` instead, so every
// element still has to be narrowed before it is used.
//
// Two object guards, because the apps rely on both meanings and they are not
// interchangeable:
//   - IsObject: fields can be read from it. Any object, arrays included. This
//     is the `value && typeof value === 'object'` test ShowTrak Server's code
//     replaced with it.
//   - IsRecord: an object with named fields. Arrays excluded. This is the
//     `typeof value === 'object' && value !== null && !Array.isArray(value)`
//     test ShowTrak Client's and ShowTrak Timers' code replaced with it.
//
// Each app had its own copy of these (the Server two: main process and
// renderer), which is why they live here.

/** `Array.isArray`, narrowing to `unknown[]` rather than `any[]`. */
export function IsArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Whether fields can be read from a value: any object (arrays included), but not
 * null or a primitive. Narrows to a record of unknown values.
 */
export function IsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** An object with named fields: not null, not a primitive, and not an array. */
export function IsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The value when it is an array, else an empty one: `Array.isArray(List) ? List
 * : []` for a list typed `readonly T[] | null | undefined`. Array.isArray
 * cannot narrow a readonly array type and widens its elements to `any`; this
 * keeps them `T`. The array is returned as it is, not copied.
 */
export function ArrayOrEmpty<T>(value: readonly T[] | null | undefined): readonly T[] {
  return IsArray(value) ? value : [];
}
