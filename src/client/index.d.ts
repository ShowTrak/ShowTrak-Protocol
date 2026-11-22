// @showtrak/protocol/client: ShowTrak Client's process-boundary contracts.
//
//   import type { ClientPreloadAPI, ClientProfile } from '@showtrak/protocol/client';
//
// The Client's Socket.IO wire to the Server is NOT here: it is shared with the
// Server, so it lives in the package root (ClientToServerEvents,
// ServerToClientEvents, ScriptCatalogWireEntry, ...). This entry point holds
// what crosses the Client's own process boundaries (main process <-> its
// windows) and what it persists across releases. The plumbing every app shares
// is re-exported from app.d.ts so the Client needs one import path for it.

export type {
  AppUpdateInfo,
  AppUpdateState,
  AppUpdateStatus,
  AssertTrue,
  ChannelListCheck,
  Unsubscribe,
  UpdateChannel,
} from '../app';
export * from './preload';
export * from './profile';
