// Per-window security guards, applied to every BrowserWindow ShowTrak Server,
// Client and Timers create: external http(s) links open in the OS browser
// (never in-app), and in-app navigation away from the loaded UI is blocked.
// Both guards fail closed (deny) on error.
import { shell } from 'electron';
import type { BrowserWindow } from 'electron';

/** Apply the guards to a window. A missing or destroyed window is left alone. */
export function applyWindowSecurityGuards(windowInstance: BrowserWindow | null | undefined): void {
  if (!windowInstance || windowInstance.isDestroyed()) return;

  windowInstance.webContents.setWindowOpenHandler(({ url }: { url: string }) => {
    try {
      if (/^https?:\/\//i.test(url)) {
        // openExternal rejects (rather than throws) when the OS cannot open it;
        // left unhandled, that reached the process guards as an error.
        Promise.resolve(shell.openExternal(url)).catch(() => undefined);
      }
    } catch (_error) {
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  windowInstance.webContents.on(
    'will-navigate',
    (event: { preventDefault(): void }, url: string) => {
      const currentURL = windowInstance.webContents.getURL();
      if (!currentURL || !url) return;
      if (url !== currentURL) {
        event.preventDefault();
      }
    }
  );
}
