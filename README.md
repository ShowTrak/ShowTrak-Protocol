<div align="center">

<a href="https://showtrak.co.uk"><img src="https://showtrak.co.uk/images/logo.png" alt="ShowTrak Protocol logo" width="128" height="128"></a>

# ShowTrak Protocol

**The shared message definitions that let every ShowTrak app talk to each other.**

[Website](https://showtrak.co.uk) · [Discord](https://discord.gg/DACmwsbSGW)

[![TypeScript][badge-typescript]](https://showtrak.co.uk)

</div>

Behind the scenes code shared by ShowTrak Server, ShowTrak Client and the ShowTrak SDKs. There is
nothing here to download or install: to use ShowTrak, head to [showtrak.co.uk](https://showtrak.co.uk).

Shared **wire-protocol type definitions** for the ShowTrak platform: the payload
shapes exchanged over Socket.IO between:

- **[ShowTrak Server](https://github.com/ShowTrak/ShowTrakServer)** (control plane)
- **[ShowTrak Client](https://github.com/ShowTrak/ShowTrakClient)** (endpoint agent)
- **ShowTrak SDKs** (e.g. the Android integration SDK)

## Why this repo exists

These types are authored as ambient TypeScript declaration files (`.d.ts`) with
**no runtime code**. That keeps them:

- **Authoritative**: one definition of the wire, shared by every surface, so a
  change to a payload cannot land on one side only.
- **Reusable**: any TypeScript project can consume them as-is.
- **Safe to import**: because they contain only types, `import type { ... }`
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
the map **and** implement it on both sides in the same change; a listener with no
emitter (or vice versa) is exactly the drift this repo exists to prevent.

```sh
npm run typecheck   # tsc --noEmit
```

Consumers pick the change up by bumping their submodule pointer:

```sh
cd shared && git pull origin main && cd .. && git add shared
```

## Part of ShowTrak

| App | What it does |
| --- | --- |
| **[ShowTrak Server](https://showtrak.co.uk/software/server)** | Monitor and control every computer and show device from one screen. |
| **[ShowTrak Client](https://showtrak.co.uk/software/client)** | The lightweight app that lets ShowTrak Server watch and control a computer. |
| **[ShowTrak Timers](https://showtrak.co.uk/software/timers)** | Show timers run from the desk, a Stream Deck, QLab or any browser. |
| **[ShowTrak Portal](https://showtrak.co.uk)** | Show reports, schedules and team collaboration for live productions. |

Find everything at **[showtrak.co.uk](https://showtrak.co.uk)**.

## Support

Questions, ideas or problems? Join the [ShowTrak Discord](https://discord.gg/DACmwsbSGW) or [open an issue](https://github.com/ShowTrak/ShowTrak-Protocol/issues).

## Licence

ShowTrak Protocol is free and open source under the [GNU AGPL-3.0](LICENSE).

[badge-typescript]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
