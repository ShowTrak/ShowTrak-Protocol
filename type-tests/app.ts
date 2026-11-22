// The plumbing every desktop app shares (src/app.d.ts) and the views built on it.

import type {
  AppMode,
  AppUpdateStatus,
  Result,
  ResultTuple,
  Setting,
  SettingGroup,
  SettingGroupView,
  SettingView,
  ShowTrakAPI,
  UpdateChannel,
  UpdateManagerStatus,
} from '@showtrak/protocol';
import type * as Timers from '@showtrak/protocol/timers';
import type { UpdateChannel as RuntimeUpdateChannel } from '../src/runtime/update-channel';
import type { Equal, Expect, Extends } from './helpers';

// The ambient UpdateChannel is the runtime's union, declared twice only so the
// ambient side never imports runtime source.
export type _UpdateChannel = Expect<Equal<UpdateChannel, RuntimeUpdateChannel>>;
export type _ServerChannel = Expect<
  Equal<UpdateManagerStatus['Channel'], UpdateChannel | undefined>
>;

// Mode is exactly the two values both apps normalise to.
export type _AppMode = Expect<Equal<AppMode, 'SHOW' | 'EDIT'>>;
export type _ServerMode = Expect<Equal<Awaited<ReturnType<ShowTrakAPI['GetMode']>>, AppMode>>;
export type _TimersMode = Expect<Equal<Awaited<ReturnType<Timers.TimersAPI['GetMode']>>, AppMode>>;

// Result narrows on its error slot; ResultTuple does not promise a value.
export function Unwrap<T>(Answer: Result<T>): T | string {
  const [Err, Value] = Answer;
  if (Err !== null) return Err;
  return Value;
}
export type _ResultIsTuple = Expect<Extends<Result<number>, ResultTuple<number>>>;
export type _TupleIsNotResult = Expect<Equal<Extends<ResultTuple<number>, Result<number>>, false>>;

// One update status for every app.
export type _ServerUpdate = Expect<
  Equal<Parameters<Parameters<ShowTrakAPI['OnAppUpdateStatus']>[0]>[0], AppUpdateStatus>
>;
export type _TimersUpdate = Expect<
  Equal<Timers.PushMap['AppUpdate:Status'], [Status: AppUpdateStatus]>
>;

// The Server's setting views are the shared settings framework's.
export type _ServerSetting = Expect<Equal<SettingView, Setting>>;
export type _ServerSettingGroup = Expect<Equal<SettingGroupView, SettingGroup>>;
// Timers' settings narrow the type (no PASSWORD) and add RequiresSave.
export type _TimersSettingType = Expect<
  Equal<Timers.SettingType, 'BOOLEAN' | 'INTEGER' | 'STRING' | 'OPTION' | 'SLIDER'>
>;
export type _TimersSettingIsSetting = Expect<Extends<Timers.SettingView, Setting>>;
export type _TimersRequiresSave = Expect<Equal<Timers.SettingView['RequiresSave'], boolean>>;
