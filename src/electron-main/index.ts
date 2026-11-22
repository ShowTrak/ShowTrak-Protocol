// @showtrak/protocol/electron-main: Electron main-process helpers the ShowTrak
// desktop apps share.
//
// Compiled JavaScript like @showtrak/protocol/runtime, for code that needs
// Electron (its `app`, `shell`, `autoUpdater`, or a BrowserWindow) or exists
// only for an Electron app's main process: the self-updater and its Squirrel
// helpers, show file associations, the per-window guards and zoom shortcuts,
// the first-paint signal, development reload and the renderer push bus.
//
// Named electron-main rather than electron: the apps' test suites stub the
// 'electron' module by matching the end of the request, which would catch
// `@showtrak/protocol/electron` too and replace this whole entry point.
//
// Each module takes the app's identity (its release repository, show file
// extension, logger, window) as an argument and keeps nothing app-specific.
// Nothing here touches Electron while loading, only when called, so the entry
// point can be required outside Electron (the apps' test suites stub
// 'electron'). Heavy dependencies are required lazily: electron-updater on a
// packaged build's first update check.
export * from './app-updater';
export * from './squirrel-releases';
export * from './file-associations';
export * from './window-guards';
export * from './window-zoom';
export * from './first-paint';
export * from './dev-reload';
export * from './renderer-bus';
