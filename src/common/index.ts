// @showtrak/protocol/common: shared code that runs anywhere.
//
// Compiled JavaScript like @showtrak/protocol/runtime, but isomorphic: it uses
// nothing beyond the language itself (no Node, no DOM, no Electron), which
// tsconfig.common.json enforces. So it can be required by a main process and
// bundled into a renderer alike, unlike the runtime entry point, which loads
// node:crypto and node:fs.
//
// What belongs here: small pure helpers that two or more apps (or both sides
// of one app) carried their own copies of. Nothing app-specific: an app's
// identity is always passed in.
export * from './guards';
export * from './versions';
export * from './arguments';
export * from './log-levels';
