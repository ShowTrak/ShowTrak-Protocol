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
formats, and the Timers Web Dashboard's socket. And it holds the code those
desktop apps share rather than copy: see [Shared code](#shared-code).

## Why this repo exists

The contracts are authored as ambient TypeScript declaration files (`.d.ts`)
with **no runtime code**. That keeps them:

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

## Shared code

Besides the contracts, the desktop apps share code that each used to carry its
own copy of, where a fix to one had to be ported to the others by hand. It is
compiled JavaScript, built into `dist/` by `tsconfig.build.json` (runtime,
common, electron-main) and `tsconfig.build.ui.json` (the renderer kit), which
the apps run in `npm run build:shared` with their own TypeScript, plus
plain-JavaScript build scripts. Each entry point is held to what its
environment provides:

| Import                             | Source              | What it is                                                                                                                                                                                    | May use                                                                                     |
| ---------------------------------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `@showtrak/protocol/runtime`       | `src/runtime`       | Node infrastructure: network-error classification, checksums, the update-channel rule, the logging primitives and the Server and Timers logger, the process guards, durable file writes       | Node. No Electron, no DOM. Main processes of all three apps                                 |
| `@showtrak/protocol/common`        | `src/common`        | Isomorphic helpers: type guards, the loose version order, script argument parsing, the log levels' order                                                                                      | The language alone: no Node, DOM or Electron (`tsconfig.common.json`). Anywhere             |
| `@showtrak/protocol/electron-main` | `src/electron-main` | Electron main-process helpers: the self-updater and its Squirrel helpers, show file associations, window guards and zoom shortcuts, the first-paint signal, dev reload, the renderer push bus | Node and Electron (electron-updater lazily). Main processes                                 |
| `@showtrak/protocol/ui/<module>`   | `src/ui`            | The renderer kit, below: the Software Update modal, dialogs, toasts, Markdown, QR codes, menus                                                                                                | The DOM, and jQuery, Bootstrap and Howler as page globals. Server and Timers renderers only |
| `shared/scripts/*.js`              | `scripts`           | Build, dev, test and release tooling: the main and renderer bundles, assets, CSS, `npm start`, `npm test`, `npm run publish`, the Electron locale trim                                        | Node, and the app's own build tools (esbuild, Electron, TypeScript). At build time          |

What holds for all of it:

- **Nothing names an app.** An app's identity (its name, release repository,
  show file extension, logs folder, logger, window) is always passed in, so an
  app's own module is a few lines of configuration around the shared one.
- **Loading is free.** The Electron modules touch Electron only when called,
  and the renderer kit the page only when called, never while loading, so the
  apps' test suites can load them under plain Node (with `electron` stubbed);
  heavy dependencies are required lazily (electron-updater, on a packaged
  build's first update check).
- **Bare imports come from the app.** `electron`, `electron-updater`,
  `@types/node` and (for the renderer kit) `@types/jquery` resolve from the
  app's own `node_modules`, which sits above `shared/`. Working on this repo on its own, they come from `tooling/`
  (`tooling/tsconfig.build.json`); `npm run setup` installs them with
  `--ignore-scripts`, so no Electron binary is downloaded.

An app maps each compiled entry point to its **built** declarations, with an
exact key ahead of the wildcard (pointing one at `shared/src` would drag the
sources into the app's program, outside its `rootDir`):

```jsonc
"paths": {
  "@showtrak/protocol": ["./shared/src/index.d.ts"],
  "@showtrak/protocol/runtime": ["./shared/dist/runtime/index.d.ts"],
  "@showtrak/protocol/common": ["./shared/dist/common/index.d.ts"],
  "@showtrak/protocol/electron-main": ["./shared/dist/electron-main/index.d.ts"],
  "@showtrak/protocol/*": ["./shared/src/*"]
}
```

Renderer configs map `@showtrak/protocol/common` the same way, and
`@showtrak/protocol/ui/*` as the renderer kit shows below. At runtime the
imports resolve by package name through `exports` (the `file:./shared`
dependency), and esbuild bundles the compiled files from `shared/dist`.

esbuild cannot tree-shake that CommonJS, so a bundle gets every module of an
entry point it imports. A page served to browsers can take one module of the
common entry point instead, `@showtrak/protocol/common/<module>` (ShowTrak
Timers' Web Dashboard imports `@showtrak/protocol/common/guards`), mapped with
`"@showtrak/protocol/common/*": ["./shared/dist/common/*"]`.

The scripts are plain CommonJS that needs nothing built (`copy-bootstrap-icons`
runs on postinstall). An app keeps its own `scripts/<name>.js`, which calls the
shared one with the app's configuration; the header of each shared script shows
that wrapper:

```js
// ShowTrak Server's scripts/build-main.js
const path = require('node:path');
const { createMainBundle } = require('../shared/scripts/build-main');

const Bundle = createMainBundle({
  root: path.resolve(__dirname, '..'),
  requiredExternals: ['sqlite3', 'electron-updater', 'mqtt'],
});

module.exports = { mainBundleOptions: Bundle.mainBundleOptions, MAIN_BUNDLE: Bundle.MAIN_BUNDLE };

if (require.main === module) Bundle.main();
```

### The renderer kit

`src/ui` is browser code that ShowTrak Server and ShowTrak Timers both run in
their renderers (Server's window and Web UI, Timers' window), so a fix is made
once rather than ported by hand. `tsconfig.build.ui.json` compiles it to
`dist/ui` (CommonJS plus declarations; `npm run build` includes it, and
`npm run build:ui` runs it alone), and each module is its own entry point,
`@showtrak/protocol/ui/<module>`, so an app's bundle only carries what it
imports.

| Module                                   | What it holds                                                      |
| ---------------------------------------- | ------------------------------------------------------------------ |
| `ui/app-updates`                         | The Software Update modal (`CreateAppUpdates`)                     |
| `ui/confirm-dialog`                      | The confirmation dialog (`CreateConfirmationDialog`)               |
| `ui/toasts`                              | Alert-style toasts and `Notify` (`CreateToasts`)                   |
| `ui/modal-header`                        | The modal titlebar (`buildModalHeader`)                            |
| `ui/markdown`                            | Release notes: safe Markdown rendering and the HTML sanitizer      |
| `ui/qr-svg`                              | QR codes as SVG strings (`QrToSvg`)                                |
| `ui/menu-placement`, `ui/menu-typeahead` | The right-click menu's placement and type-to-search                |
| `ui/settings-tabs`                       | Which Preferences tab shows, and how a setting's value reads       |
| `ui/html`, `ui/errors`, `ui/icons`       | `Safe`, `ErrorMessage`, `HandleNonFatalError`, an app's icon style |

What differs between the apps (names, icon style, which buttons open what, the
preload API, what the app does around a dialog) is passed in once, in the app's
own module, which re-exports the result:

```ts
// ShowTrak Timers, src/UI/js/app/lib/toasts.ts
export const { Notify, showAlertStyleToast, iconForType } = CreateToasts({ IconStyle: 'fill' });
export const ConfirmationDialog = CreateConfirmationDialog({
  OnActiveChange: (Active) => setConfirmDialogActive(Active),
});
```

ShowTrak Server and ShowTrak Timers build the kit with their own TypeScript
(ShowTrak Client does not: it has no jQuery, and `tsconfig.build.json` never
compiles `src/ui`), and typecheck their renderers against the built
declarations:

```jsonc
// package.json
"build:shared": "tsc -p shared/tsconfig.build.json && tsc -p shared/tsconfig.build.ui.json"

// tsconfig.renderer.json and tsconfig.renderer.test.json
"paths": {
  "@showtrak/protocol": ["./shared/src/index.d.ts"],
  "@showtrak/protocol/ui/*": ["./shared/dist/ui/*"],
  "@showtrak/protocol/*": ["./shared/src/*"]
},
"include": [/* the app's own */ "shared/src/ui/vendors.d.ts"]
```

The rules for code in `src/ui`:

- It belongs here only when both apps run the same logic. One app's surfaces
  (Server's execution panel, Timers' Web Dashboard) stay in that app.
- jQuery, Bootstrap and Howler are page globals loaded by `<script>` tags and
  are never imported. `src/ui/vendors.d.ts` declares Bootstrap and Howler for
  both apps, so an app does not declare them again; `@types/jquery` types `$`.
- Nothing runs at import time: the apps' renderer tests `require()` these files
  under plain Node, with no `document`, `window` or `$`.

`spec/ui` covers each module in each app's configuration, against `dist/ui`,
with a small fake page (`spec/ui/helpers/fake-dom.js`) rather than jsdom.

## Layout

```text
package.json          # @showtrak/protocol (not published to npm)
tsconfig.json         # standalone type-check config
tsconfig.build.json   # emits the compiled entry points to dist/ (what the apps run)
tsconfig.common.json  # checks src/common against the language alone
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
  sdk.d.ts            # the /sdk control API (SDK, Companion module, ShowTrak Remote)
  webui.d.ts          # ShowTrak Server's Web UI socket (/ui)
  app.d.ts            # plumbing every desktop app shares (IPC results, updates, settings)
  views.d.ts          # ShowTrak Server's view models (renderer + Web UI)
  preload.d.ts        # ShowTrak Server's Electron preload bridges
  client/             # @showtrak/protocol/client: ShowTrak Client's preloads, profile
  timers/             # @showtrak/protocol/timers: ShowTrak Timers' IPC, views, Web Dashboard
  runtime/            # @showtrak/protocol/runtime: Node code the apps share
  common/             # @showtrak/protocol/common: isomorphic code the apps share
  electron-main/      # @showtrak/protocol/electron-main: Electron main-process code the apps share
  ui/                 # @showtrak/protocol/ui/*: the renderer kit (see above)
scripts/              # build, dev, test and release scripts the apps call
spec/                 # behaviour specs for the compiled code and scripts, run by npm test
type-tests/           # compile-time assertions about src/, run by npm run typecheck
tooling/              # this repo's own lint, format and TypeScript tooling
e2e/                  # end-to-end checks with real built apps (see e2e/README.md)
```

The rule for what lives here: **every contract that crosses a process or
network boundary, for any ShowTrak app, lives here**. That covers the wire
between apps, each app's preload bridge and IPC channels (main process to
renderer), its view models, what it persists for later releases to read, and
any socket it serves. Types that describe an app's internal module wiring,
used inside one process of one app, stay in that app.

Everything outside `src/runtime`, `src/common`, `src/electron-main` and `src/ui`
is types only. Where a contract has a runtime
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
`shared/`. The specs are `spec/**/*.spec.js` for that reason.

Shared code needs a spec for each app's configuration of it, as it would have
had in the app: `spec/` holds the apps' own tests of everything that moved
here, run against `dist/` with Electron stubbed (`spec/helpers/`).

```sh
npm run setup         # once: installs the tooling in tooling/
npm run lint          # ESLint, with ShowTrak Server's rules
npm run format        # Prettier (format:check to only check)
npm run typecheck     # tsc --noEmit, plus the type tests
npm run build         # compiles src/runtime, src/common, src/electron-main and src/ui to dist/
npm run build:ui      # compiles just the renderer kit
npm test              # builds, then runs spec/**/*.spec.js
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
