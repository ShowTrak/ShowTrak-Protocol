// Each entry point resolves the way the apps import it. Compiled twice (see
// npm run typecheck):
//   - tsconfig.json: node16 resolution through the apps' tsconfig `paths`
//     (`@showtrak/protocol` -> src/index.d.ts, `@showtrak/protocol/*` -> src/*),
//     as ShowTrak Server, Client and Timers map it for their main processes;
//   - tsconfig.exports.json: bundler resolution with no `paths`, through this
//     package's own `exports` map, as a renderer config without the mapping
//     (ShowTrak Timers' today) resolves it from node_modules.

import type {
  AppConfig,
  ClientToServerEvents,
  GroupView as ServerGroupView,
  PreloaderAPI as ServerPreloaderAPI,
  ShowTrakAPI,
  SettingView as ServerSettingView,
} from '@showtrak/protocol';
import type {
  ClientPreloadAPI,
  ClientProfile,
  IdentifyOverlayDetails,
  IpcResult,
  LoadedSnapshot,
  Unsubscribe as ClientUnsubscribe,
} from '@showtrak/protocol/client';
import type {
  DashboardTimer,
  GroupView as TimersGroupView,
  PreloaderAPI as TimersPreloaderAPI,
  SettingView as TimersSettingView,
  TimerView,
  TimersAPI,
  Unsubscribe as TimersUnsubscribe,
  WebDashboardClientToServerEvents,
  WebDashboardServerToClientEvents,
} from '@showtrak/protocol/timers';
import type { Equal, Expect, Extends } from './helpers';

// Every entry point resolves to real declarations, not to `any`.
export type _ServerAPI = Expect<Equal<Extends<ShowTrakAPI, { GetMode: unknown }>, true>>;
export type _ClientAPI = Expect<Equal<Extends<ClientPreloadAPI, { Loaded: unknown }>, true>>;
export type _TimersAPI = Expect<Equal<Extends<TimersAPI, { ListTimers: unknown }>, true>>;
export type _NotAny = Expect<Equal<Equal<TimerView, never>, false>>;

// Names the apps share are different shapes in each entry point: the reason
// Client and Timers contracts are not in the root barrel.
export type _GroupViewsDiffer = Expect<Equal<Equal<ServerGroupView, TimersGroupView>, false>>;
export type _SettingViewsDiffer = Expect<Equal<Equal<ServerSettingView, TimersSettingView>, false>>;
export type _SplashDiffers = Expect<Equal<Equal<ServerPreloaderAPI, TimersPreloaderAPI>, false>>;
export type _ServerSplash = Expect<
  Equal<ServerPreloaderAPI['GetConfig'], () => Promise<AppConfig>>
>;

// The shared plumbing each entry point re-exports is the same type.
export type _Unsubscribe = Expect<Equal<ClientUnsubscribe, TimersUnsubscribe>>;
export type _LoadedProfile = Expect<Equal<LoadedSnapshot['Profile'], ClientProfile>>;
export type _IpcResult = Expect<
  Equal<IpcResult<true>, [error: null, value: true] | [error: string, value: null]>
>;
export type _IdentifyDetails = Expect<Equal<IdentifyOverlayDetails['IPs'], string[]>>;

// The Client's wire to the Server comes from the root, shared with the Server.
export type _ClientWire = Expect<
  Equal<Extends<ClientToServerEvents, { GetScripts: unknown }>, true>
>;

// The Web Dashboard's Socket.IO maps.
export type _DashboardTimers = Expect<
  Equal<Parameters<WebDashboardServerToClientEvents['timers:update']>[0], DashboardTimer[]>
>;
export type _DashboardLogin = Expect<
  Equal<
    Parameters<WebDashboardClientToServerEvents['auth:login']>[0],
    { password: string } | { token: string }
  >
>;
