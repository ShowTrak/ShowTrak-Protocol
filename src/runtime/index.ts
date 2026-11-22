// @showtrak/protocol/runtime: shared RUNTIME code for the ShowTrak desktop apps'
// main processes (ShowTrak Server, Client and Timers).
//
// The rest of this package (src/*.d.ts, imported as `@showtrak/protocol`) is
// ambient type declarations that vanish at build time. This entry point is
// different: it is real, compiled JavaScript that the apps execute, so it is
// published from ./dist and each app depends on this package with `file:./shared`
// to make `@showtrak/protocol/runtime` resolve at runtime as well as at
// typecheck time.
//
// What belongs here: Node infrastructure that is genuinely the same in two or
// more apps and has no Electron, DOM, or app-specific dependency. What does
// NOT: anything wired to one app's managers; that stays in the app. Where a
// module needs an app's identity (its name, its logs folder, its logger), it
// takes it as an argument. Code that runs in renderers too belongs in
// @showtrak/protocol/common; code that needs Electron in
// @showtrak/protocol/electron.
export * from './network-errors';
export * from './checksum';
export * from './logging';
export * from './app-logger';
export * from './update-channel';
export * from './process-guards';
export * from './files';
