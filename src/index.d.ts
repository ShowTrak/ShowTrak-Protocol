// @showtrak/protocol: barrel re-export of the shared wire-protocol types, and of
// ShowTrak Server's process-boundary contracts. Import with type-only syntax:
//   import type { HeartbeatPayload } from '@showtrak/protocol';
//
// ShowTrak Client's and ShowTrak Timers' own process-boundary contracts are NOT
// re-exported here: their names overlap the Server's (each app has its own
// GroupView, SettingView, window.API ...), so each has its own entry point:
//   import type { ClientPreloadAPI } from '@showtrak/protocol/client';
//   import type { TimersAPI } from '@showtrak/protocol/timers';

export * from './common';
export * from './vitals';
export * from './telemetry';
export * from './adoption';
export * from './integrated';
export * from './execution';
export * from './scripts';
export * from './variables';
export * from './events';
export * from './app';
export * from './views';
export * from './preload';
