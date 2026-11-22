// Channel allowlists and the preload contracts built on them
// (src/app.d.ts, src/client/preload.d.ts, src/timers/api.d.ts).

import type { AssertTrue, ChannelListCheck } from '@showtrak/protocol';
import type * as Client from '@showtrak/protocol/client';
import type * as Timers from '@showtrak/protocol/timers';
import type { Equal, Expect } from './helpers';

// ---- ChannelListCheck --------------------------------------------------------------

// Runtime lists, declared the way an app declares its allowlists.
export const Exact = ['Timer:Get', 'Timers:List'] as const;
export const Short = ['Timer:Get'] as const;
export const Extra = ['Timer:Get', 'Timers:List', 'Timer:Explode'] as const;
type Declared = 'Timer:Get' | 'Timers:List';

export type _Exact = AssertTrue<ChannelListCheck<Declared, typeof Exact>>;
// A declared channel missing from the runtime list is named...
export type _Unlisted = Expect<
  Equal<ChannelListCheck<Declared, typeof Short>, { Undeclared: never; Unlisted: 'Timers:List' }>
>;
// ...and so is a listed channel the contract does not declare.
export type _Undeclared = Expect<
  Equal<ChannelListCheck<Declared, typeof Extra>, { Undeclared: 'Timer:Explode'; Unlisted: never }>
>;
// Order and duplicates do not matter; membership does.
export type _Reordered = AssertTrue<
  ChannelListCheck<Declared, readonly ['Timers:List', 'Timer:Get', 'Timer:Get']>
>;

// ---- A bridge's channel table agrees with its API and its channel maps ---------------
//
// For every method of a preload API, the table names its channel. An invoke
// method takes the channel's Args and answers Promise<Result>; a subscribe
// method's callback receives the channel's push arguments.

type InvokeMethods<Table, Invoke> = {
  [M in keyof Table]: Table[M] extends keyof Invoke ? M : never;
}[keyof Table];

/** The methods of API whose invoke or push arguments disagree with the channel maps. */
type InvokeMismatches<API, Table extends Record<keyof API, string>, Invoke> = {
  [M in InvokeMethods<Table, Invoke> & keyof API]: API[M] extends (...Args: infer A) => infer R
    ? Invoke[Table[M] & keyof Invoke] extends { Args: infer Args; Result: infer Answer }
      ? Equal<A, Args> extends true
        ? Equal<R, Promise<Answer>> extends true
          ? never
          : M
        : M
      : M
    : M;
}[InvokeMethods<Table, Invoke> & keyof API];

type PushMismatches<API, Table extends Record<keyof API, string>, Invoke, Push> = {
  [M in Exclude<keyof API, InvokeMethods<Table, Invoke>>]: API[M] extends (
    Callback: (...Args: infer A) => void
  ) => unknown
    ? Equal<A, Push[Table[M] & keyof Push]> extends true
      ? never
      : M
    : M;
}[Exclude<keyof API, InvokeMethods<Table, Invoke>>];

// ShowTrak Timers.
export type _TimersEveryMethodMapped = Expect<
  Equal<keyof Timers.TimersAPIChannels, keyof Timers.TimersAPI>
>;
export type _TimersEveryChannelUsed = Expect<
  Equal<
    Timers.TimersAPIChannels[keyof Timers.TimersAPIChannels],
    Timers.InvokeChannel | Timers.PushChannel
  >
>;
export type _TimersInvoke = Expect<
  Equal<InvokeMismatches<Timers.TimersAPI, Timers.TimersAPIChannels, Timers.InvokeMap>, never>
>;
export type _TimersPush = Expect<
  Equal<
    PushMismatches<Timers.TimersAPI, Timers.TimersAPIChannels, Timers.InvokeMap, Timers.PushMap>,
    never
  >
>;
export type _TimersSplash = Expect<
  Equal<Timers.PreloaderAPI['GetConfig'], () => Promise<Timers.AppConfigView>>
>;

// ShowTrak Client.
export type _ClientEveryMethodMapped = Expect<
  Equal<keyof Client.ClientPreloadChannels, keyof Client.ClientPreloadAPI>
>;
export type _ClientEveryChannelUsed = Expect<
  Equal<
    Client.ClientPreloadChannels[keyof Client.ClientPreloadChannels],
    Client.InvokeChannel | Client.PushChannel
  >
>;
export type _ClientInvoke = Expect<
  Equal<
    InvokeMismatches<Client.ClientPreloadAPI, Client.ClientPreloadChannels, Client.InvokeMap>,
    never
  >
>;
export type _ClientPush = Expect<
  Equal<
    PushMismatches<
      Client.ClientPreloadAPI,
      Client.ClientPreloadChannels,
      Client.InvokeMap,
      Client.PushMap
    >,
    never
  >
>;
// The overlay windows' calls answer what their channels answer.
export type _IdentifyClose = Expect<
  Equal<
    ReturnType<Client.IdentifyPreloadAPI['Close']>,
    Promise<Client.OverlayInvokeMap['Identify:Close']['Result']>
  >
>;
export type _CountdownCancel = Expect<
  Equal<
    ReturnType<Client.LaunchCountdownPreloadAPI['Cancel']>,
    Promise<Client.OverlayInvokeMap['LaunchCountdown:Cancel']['Result']>
  >
>;
// The two allowlists the Client's main process registers do not overlap.
export type _ClientChannelsDisjoint = Expect<
  Equal<Extract<Client.InvokeChannel, Client.OverlayInvokeChannel>, never>
>;
