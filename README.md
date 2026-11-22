<div align="center">

<a href="https://showtrak.co.uk"><img src="https://showtrak.co.uk/images/logo.png" alt="ShowTrak Protocol logo" width="128" height="128"></a>

# ShowTrak Protocol

**The shared message definitions that let every ShowTrak app talk to each other.**

[Website](https://showtrak.co.uk) · [Discord](https://discord.gg/DACmwsbSGW)

[![TypeScript][badge-typescript]](https://showtrak.co.uk) [![CI status][badge-ci]](https://github.com/ShowTrak/ShowTrak-Protocol/actions/workflows/ci.yml)

</div>

Behind the scenes code shared by ShowTrak Server, ShowTrak Client and the ShowTrak SDKs. There is
nothing here to download or install: to use ShowTrak, head to [showtrak.co.uk](https://showtrak.co.uk).

Shared **wire-protocol type definitions** for the ShowTrak platform: the payload
shapes exchanged over Socket.IO between:

- **[ShowTrak Server](https://github.com/ShowTrak/ShowTrakServer)** (control plane)
- **[ShowTrak Client](https://github.com/ShowTrak/ShowTrakClient)** (endpoint agent)
- **ShowTrak SDKs** (e.g. the Android integration SDK)

It also holds every other contract that crosses a process or network boundary
in a ShowTrak desktop app (Server, Client and
**[ShowTrak Timers](https://github.com/ShowTrak/ShowTrakTimers)**): each app's
Electron preload bridge and IPC channels, its view models, its persisted
formats, and the Timers Web Dashboard's socket.

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

There are three type entry points, one per app surface. The root holds the
wire every app shares plus ShowTrak Server's own contracts; ShowTrak Client and
ShowTrak Timers each have their own, because their names overlap the Server's
(each app has its own `GroupView`, `SettingView`, `window.API` and so on):

```ts
import type { ShowTrakAPI, ClientToServerEvents } from '@showtrak/protocol';
import type { ClientPreloadAPI, ClientProfile } from '@showtrak/protocol/client';
import type { TimersAPI, TimerView } from '@showtrak/protocol/timers';
```

The `paths` mapping above resolves all three under both `node16` and `bundler`
module resolution. A config without the mapping resolves them from
`node_modules/@showtrak/protocol` (the `file:./shared` dependency) through the
`exports` map, or `typesVersions` under `node10`.

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
package.json          # @showtrak/protocol (not published to npm)
tsconfig.json         # standalone type-check config
src/
  index.d.ts          # @showtrak/protocol: the wire, plus ShowTrak Server's contracts
  common.d.ts         # shared primitives (MacAddressMap, etc.)
  vitals.d.ts         # CPU / RAM / uptime telemetry
  telemetry.d.ts      # heartbeat, system info, USB, displays, network, apps
  adoption.d.ts       # adoption handshake + lifecycle
  integrated.d.ts     # integrated-client actions / state (SDK surface)
  execution.d.ts      # script / event / launch-config execution contracts
  scripts.d.ts        # the script catalog, as every supported Server sends it
  variables.d.ts      # show variables
  events.d.ts         # Socket.IO client<->server event maps
  app.d.ts            # plumbing every desktop app shares (IPC results, updates, settings)
  views.d.ts          # ShowTrak Server's view models (renderer + Web UI)
  preload.d.ts        # ShowTrak Server's Electron preload bridges
  client/             # @showtrak/protocol/client: ShowTrak Client's preloads, profile
  timers/             # @showtrak/protocol/timers: ShowTrak Timers' IPC, views, Web Dashboard
  runtime/            # @showtrak/protocol/runtime: the runtime code the apps share
type-tests/           # compile-time assertions about src/, run by npm run typecheck
e2e/                  # end-to-end checks with real built apps (see e2e/README.md)
```

The rule for what lives here: **every contract that crosses a process or
network boundary, for any ShowTrak app, lives here**. That covers the wire
between apps, each app's preload bridge and IPC channels (main process to
renderer), its view models, what it persists for later releases to read, and
any socket it serves. Types that describe an app's internal module wiring,
used inside one process of one app, stay in that app.

Everything outside `src/runtime` is types only. Where a contract has a runtime
half, such as an app's channel allowlist, the values stay in the app and are
checked against the types here. `ChannelListCheck` proves a list names exactly
the declared channels, both ways:

```ts
import type { AssertTrue, ChannelListCheck, InvokeChannel } from '@showtrak/protocol/timers';

export const INVOKE_CHANNELS = ['Config:Get', 'Loaded' /* ... */] as const;
type _InvokeChannelsMatch = AssertTrue<ChannelListCheck<InvokeChannel, typeof INVOKE_CHANNELS>>;
```

## Making changes

The event maps in `events.d.ts` are the contract. When adding an event, add it to
the map **and** implement it on both sides in the same change; a listener with no
emitter (or vice versa) is exactly the drift this repo exists to prevent.

Describe the wire as it really is, including what older releases send. A new
Server must keep working with older Clients and SDKs, and a new Client is still
adopted by older Servers, so a field an older release omits is optional and says
which release added it (see `ScriptCatalogWireEntry`). Never tidy a type in a way
that would let an app drop its compatibility handling.

`type-tests/` holds compile-time assertions about these types (helpers in
`type-tests/helpers.ts`). Add one when a change has a shape worth pinning down.
Keep test files out of node --test's patterns (`*.test.*`, `test-*`, a `test/`
folder): ShowTrak Client runs `node --test` from its root, where this repo is
`shared/`.

```sh
npm run setup         # once: installs the tooling in tooling/
npm run lint          # ESLint, with ShowTrak Server's rules
npm run format        # Prettier (format:check to only check)
npm run typecheck     # tsc --noEmit, plus the type tests
npm run build         # compiles src/runtime to dist/runtime
```

CI runs all of these on every push. The tooling has its own `package.json` in
`tooling/` rather than the root one: the apps install this repo as a `file:`
dependency, and npm would otherwise install its tooling into every app too.

Consumers pick the change up by bumping their submodule pointer:

```sh
cd shared && git pull origin main && cd .. && git add shared
```

## End-to-end checks

[`e2e/`](e2e/README.md) runs real built apps against each other: new and released
Servers and Clients in every upgrade pairing, the Companion modules, and the QLab
definition. CI runs it nightly, on changes to it, and from the Server and Client
release workflows, so nothing is published that breaks an older install.

## Part of ShowTrak

| App                                                           | What it does                                                                |
| ------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **[ShowTrak Server](https://showtrak.co.uk/software/server)** | Monitor and control every computer and show device from one screen.         |
| **[ShowTrak Client](https://showtrak.co.uk/software/client)** | The lightweight app that lets ShowTrak Server watch and control a computer. |
| **[ShowTrak Timers](https://showtrak.co.uk/software/timers)** | Show timers run from the desk, a Stream Deck, QLab or any browser.          |
| **[ShowTrak Portal](https://showtrak.co.uk)**                 | Show reports, schedules and team collaboration for live productions.        |

Find everything at **[showtrak.co.uk](https://showtrak.co.uk)**.

## Support

Questions, ideas or problems? Join the [ShowTrak Discord](https://discord.gg/DACmwsbSGW) or [open an issue](https://github.com/ShowTrak/ShowTrak-Protocol/issues).

## Licence

ShowTrak Protocol is free and open source under the [GNU AGPL-3.0](LICENSE).

[badge-typescript]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[badge-ci]: https://img.shields.io/github/actions/workflow/status/ShowTrak/ShowTrak-Protocol/ci.yml?branch=main&style=for-the-badge&logo=githubactions&logoColor=white&label=CI
