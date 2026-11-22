// Development only: reload the window when the built renderer changes.
//
// `npm start` (the apps' scripts/dev.js, on shared/scripts/dev.js) rebuilds
// dist/UI in place as the renderer sources, markup and CSS change. Reloading
// the page re-runs the renderer, which pulls fresh state through 'Loaded',
// while the main process (connected sockets, running timers, monitoring loops,
// the open show) carries on untouched. Restarting Electron for a CSS tweak used
// to cost all of that.
//
// Inert unless the dev script set SHOWTRAK_DEV_RELOAD=1, and never in a
// packaged app.
import { app } from 'electron';
import fs from 'fs';

import type { AppLoggerLike } from '../runtime/logging';

/** The environment variable the dev script sets to turn this on. */
export const DEV_RELOAD_ENV = 'SHOWTRAK_DEV_RELOAD';

// A rebuild writes several files in quick succession; reload once they settle.
const SETTLE_MS = 250;

/** The window to reload: a BrowserWindow, of which only this is used. */
export interface DevReloadWindow {
  isDestroyed(): boolean;
  webContents: { reloadIgnoringCache(): void };
}

export interface DevReloadOptions {
  /** The built renderer folder to watch: the app's `path.join(DIST_ROOT, 'UI')`. */
  Root: string;
  /** The current main window, if there is one. */
  GetWindow: () => DevReloadWindow | null;
  /** The app's `CreateLogger('DevReload')`. */
  Logger: AppLoggerLike;
}

let Started = false;

/** Start watching, when this is a development run that asked for it. Once per process. */
export function StartDevReload(Options: DevReloadOptions): void {
  if (Started || app.isPackaged || process.env[DEV_RELOAD_ENV] !== '1') return;
  Started = true;

  const { Root, GetWindow, Logger } = Options;
  let Timer: ReturnType<typeof setTimeout> | null = null;
  try {
    fs.watch(Root, { recursive: true }, () => {
      if (Timer) clearTimeout(Timer);
      Timer = setTimeout(() => {
        Timer = null;
        const Window = GetWindow();
        if (Window && !Window.isDestroyed()) {
          Logger.log('Renderer rebuilt; reloading the window');
          Window.webContents.reloadIgnoringCache();
        }
      }, SETTLE_MS);
    });
    Logger.log(`Watching ${Root} for renderer rebuilds`);
  } catch (Err) {
    Logger.warn('Could not watch the renderer output; reload the window manually.', Err);
  }
}
