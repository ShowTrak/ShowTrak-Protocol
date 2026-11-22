// @showtrak/protocol/common's guards narrow to types with no `any` in them,
// which is the reason they exist (Array.isArray narrows to `any[]`).
import { ArrayOrEmpty, IsArray, IsObject, IsRecord } from '../src/common/guards';
import type { Equal, Expect } from './helpers';

declare const Value: unknown;
declare const List: readonly string[] | null | undefined;

export function Narrowing() {
  if (IsArray(Value)) {
    type _IsArray = Expect<Equal<typeof Value, unknown[]>>;
  }
  if (IsObject(Value)) {
    type _IsObject = Expect<Equal<typeof Value, Record<string, unknown>>>;
  }
  if (IsRecord(Value)) {
    type _IsRecord = Expect<Equal<typeof Value, Record<string, unknown>>>;
  }
  const _Items = ArrayOrEmpty(List);
  type _ArrayOrEmpty = Expect<Equal<typeof _Items, readonly string[]>>;
}
