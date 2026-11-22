// The `/sdk` namespace (src/sdk.d.ts).

import type {
  AppMode,
  SdkClientToServerEvents,
  SdkCommandArgs,
  SdkCommandEmitArgs,
  SdkCommandName,
  SdkCommandResult,
  SdkDeviceOnlyPushChannel,
  SdkPushChannel,
  SdkServerToClientEvents,
} from '@showtrak/protocol';
import type { Equal, Expect, Extends } from './helpers';

// A command's name selects its arguments: a Socket.IO emit typed with this map
// cannot send one command's arguments under another's name.
type EmitFor<C extends SdkCommandName> = Extract<SdkCommandEmitArgs, [C, ...unknown[]]>;
export type _ScriptArgs = Expect<
  Equal<EmitFor<'script.client'>[1], { slug: string; scriptSlug: string }>
>;
export type _ModeArgs = Expect<Equal<EmitFor<'mode.set'>[1], { mode: AppMode }>>;
export type _Mismatched = Expect<
  Equal<Extends<['mode.set', { slug: string }, () => void], SdkCommandEmitArgs>, false>
>;
// Older SDKs' view.set ({ compact }) is still accepted.
export type _LegacyView = Expect<Extends<{ compact: true }, SdkCommandArgs['view.set']>>;
export type _CommandAck = Expect<Equal<Parameters<EmitFor<'wol.all'>[2]>[0], SdkCommandResult>>;
export type _CommandEvent = Expect<
  Equal<Parameters<SdkClientToServerEvents['command']>, SdkCommandEmitArgs>
>;

// The forwarded channels are the push map minus the two per-session events,
// and the device-only ones are among them.
export type _DeviceOnlyForwarded = Expect<Extends<SdkDeviceOnlyPushChannel, SdkPushChannel>>;
export type _PerSession = Expect<
  Equal<
    Exclude<keyof SdkServerToClientEvents, SdkPushChannel>,
    'paired' | 'MonitorLiveLevels:Frames'
  >
>;
