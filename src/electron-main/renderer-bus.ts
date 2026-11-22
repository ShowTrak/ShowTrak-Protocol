// Central renderer push bus (ShowTrak Server and ShowTrak Timers).
//
// Fans out main-process push events to every registered "renderer sink". A sink
// is any surface that renders the app's UI: the Electron desktop window and
// each authed web socket (the Server's Web UI). Routing every push through one
// bus guarantees the desktop and web surfaces receive identical events and
// cannot drift apart, which is the root cause the Server's Web UI historically
// fell behind.
//
// Sinks decide for themselves which channels they care about (e.g. the web sink
// applies an allowlist + per-channel serialization); the bus is a dumb fan-out.
//
// Typed by the app's push map (channel -> argument tuple), the same map its
// preload's subscribe() hands to the page, so a channel can only be pushed with
// the arguments its subscribers are declared to receive. ShowTrak Timers passes
// @showtrak/protocol/timers' PushMap; an untyped bus takes any channel.

/** Channel name -> the arguments pushed with it. */
export type PushArgumentMap<M> = { [C in keyof M]: readonly unknown[] };

/** A surface that renders pushes. */
export type RendererSink<M extends PushArgumentMap<M> = Record<string, unknown[]>> = <
  C extends keyof M & string,
>(
  channel: C,
  ...args: M[C]
) => void;

export interface RendererBus<M extends PushArgumentMap<M> = Record<string, unknown[]>> {
  /** Register a sink. Returns an unsubscribe handle. */
  RegisterRendererSink(sink: RendererSink<M>): () => void;
  /**
   * Push a channel + payload to every registered sink. A throwing sink is
   * isolated, so one misbehaving surface can never break delivery to the others.
   */
  PushToRenderers<C extends keyof M & string>(channel: C, ...args: M[C]): void;
}

/** Create the app's bus. Call once, when the app's module loads. */
export function CreateRendererBus<
  M extends PushArgumentMap<M> = Record<string, unknown[]>,
>(): RendererBus<M> {
  const Sinks = new Set<RendererSink<M>>();
  return {
    RegisterRendererSink(sink) {
      Sinks.add(sink);
      return () => {
        Sinks.delete(sink);
      };
    },
    PushToRenderers(channel, ...args) {
      for (const sink of Sinks) {
        try {
          sink(channel, ...args);
        } catch {
          // Intentionally swallow: renderer delivery is best-effort per surface.
        }
      }
    },
  };
}
