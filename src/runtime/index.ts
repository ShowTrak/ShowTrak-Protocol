// @showtrak/protocol/runtime — shared RUNTIME code for ShowTrakServer and
// ShowTrakClient.
//
// The rest of this package (src/*.d.ts, imported as `@showtrak/protocol`) is
// ambient type declarations that vanish at build time. This entry point is
// different: it is real, compiled JavaScript that both apps execute, so it is
// published from ./dist and each app depends on this package with `file:./shared`
// to make `@showtrak/protocol/runtime` resolve at runtime as well as at
// typecheck time.
//
// What belongs here: infrastructure that is genuinely identical in both apps and
// has no Electron, DOM, or app-specific dependency. What does NOT: anything
// parameterised by one app's identity or wired to its managers — that stays in
// the app and takes what it needs as an argument.
export * from './network-errors';
export * from './checksum';
