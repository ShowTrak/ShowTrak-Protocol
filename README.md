# @showtrak/protocol

Shared **wire-protocol type definitions** for the ShowTrak platform — the payload
shapes exchanged over Socket.IO between:

- **[ShowTrak Server](https://github.com/ShowTrak/ShowTrakServer)** (control plane)
- **[ShowTrak Client](https://github.com/ShowTrak/ShowTrakClient)** (endpoint agent)
- **ShowTrak SDKs** (e.g. the Android integration SDK)

## Why this repo exists

These types are authored as ambient TypeScript declaration files (`.d.ts`) with
**no runtime code**. That keeps them:

- **Authoritative** — one definition of the wire, shared by every surface, so a
  change to a payload cannot land on one side only.
- **Reusable** — any TypeScript project can consume them as-is.
- **Safe to import** — because they contain only types, `import type { ... }`
  statements are fully erased at compile time (no runtime dependency).

This repo is consumed as a **git submodule**, not an npm package. It is checked
out at `shared/` in each consuming app and mapped to the `@showtrak/protocol`
package name via tsconfig paths.

## Consuming it

Add the submodule at `shared/`:

```sh
git submodule add https://github.com/ShowTrak/ShowTrak-Protocol.git shared
```

Map the package name in the consumer's `tsconfig.json`:

```jsonc
"paths": {
  "@showtrak/protocol": ["./shared/src/index.d.ts"],
  "@showtrak/protocol/*": ["./shared/src/*"]
}
```

Import with **type-only** syntax:

```ts
import type { HeartbeatPayload, Vitals } from '@showtrak/protocol';
```

### CI

Every `actions/checkout` in a consuming repo must fetch submodules, or the path
mapping resolves to an empty directory:

```yaml
- uses: actions/checkout@v7
  with:
    submodules: recursive
```

Clone consumers with `git clone --recursive`, or run
`git submodule update --init --recursive` in an existing checkout.

## Layout

```text
package.json          # @showtrak/protocol (types-only, not published to npm)
tsconfig.json         # standalone type-check config
src/
  index.d.ts          # barrel re-export
  common.d.ts         # shared primitives (MacAddressMap, etc.)
  vitals.d.ts         # CPU / RAM / uptime telemetry
  telemetry.d.ts      # heartbeat, system info, USB, displays, network, apps
  adoption.d.ts       # adoption handshake + lifecycle
  integrated.d.ts     # integrated-client actions / state (SDK surface)
  execution.d.ts      # script / event / launch-config execution contracts
  events.d.ts         # Socket.IO client<->server event maps
  views.d.ts          # server view models (server + Web UI)
  preload.d.ts        # ShowTrak Server's Electron preload bridge contract
```

`views.d.ts` and `preload.d.ts` describe **server-internal** surfaces rather than
the client wire. They live here because the Server's Web UI and renderer both
consume them; the Client has its own, separate preload contract in its own repo.

## Making changes

The event maps in `events.d.ts` are the contract. When adding an event, add it to
the map **and** implement it on both sides in the same change — a listener with no
emitter (or vice versa) is exactly the drift this repo exists to prevent.

```sh
npm run typecheck   # tsc --noEmit
```

Consumers pick the change up by bumping their submodule pointer:

```sh
cd shared && git pull origin main && cd .. && git add shared
```

## License

AGPL-3.0-only, matching the rest of the ShowTrak platform.
