// @showtrak/protocol/timers: ShowTrak Timers' process-boundary contracts.
//
//   import type { TimersAPI, TimerView, InvokeChannel } from '@showtrak/protocol/timers';
//
// Separate from the package root because Timers' names overlap the Server's
// (GroupView, SettingView, PreloaderAPI ... are different shapes in each app).
// Types only: the channel lists, constants and normalisers that go with them
// are runtime code and stay in the Timers repo, checked against these. The
// plumbing every app shares is re-exported from app.d.ts so Timers needs one
// import path for it.

export type {
  AppMode,
  AppUpdateInfo,
  AppUpdateState,
  AppUpdateStatus,
  AssertTrue,
  ChannelListCheck,
  Failure,
  Ok,
  Result,
  ResultTuple,
  SettingDefinition,
  SettingGroup,
  SettingScope,
  SettingValue,
  ShowFileInfo,
  ShowFileOpenOutcome,
  ShowFileRequest,
  ShowFileRequestSource,
  ShowFileUpgrade,
  SquirrelPackage,
  Unsubscribe,
  UpdateChannel,
} from '../app';
export * from './api';
export * from './dashboard';
export * from './groups';
export * from './timers';
