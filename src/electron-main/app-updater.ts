// An app's own self-update flow (main process), shared by ShowTrak Server and
// ShowTrak Timers. Timers' copy was "a port of ShowTrak Server's updater:
// same states, same channels, same automatic-update rules, pointed at this
// app's releases"; the app's identity is now all that differs, and is passed
// in (CreateAppUpdater's options).
//
//   - Dev/unpacked: a simulated check/install sequence for UI testing.
//   - Packaged Windows (Squirrel): Electron's built-in autoUpdater against GitHub.
//   - Packaged elsewhere: electron-updater against the public GitHub repo.
//
// Status is pushed to the renderer on the 'AppUpdate:Status' channel through
// the window provider handed to Register(); the renderer drives the flow
// through the 'AppUpdate:Check' and 'AppUpdate:Install' invoke channels.
//
// electron-updater is required lazily, on a packaged build's first check: it
// costs ~25 ms to load, and unpackaged and Squirrel builds never use it. The
// apps' main bundles keep it external (scripts/build-main.js).
import { app, autoUpdater as SquirrelUpdater, net } from 'electron';
import type { FeedURLOptions } from 'electron';
import type { AppUpdater, UpdateInfo } from 'electron-updater';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { spawnSync } from 'child_process';

import type { AppUpdateInfo, AppUpdateStatus } from '@showtrak/protocol';
import { IsRecord } from '../common/guards';
import type { AppLoggerLike } from '../runtime/logging';
import { NormalizeUpdateChannel, ResolveChannelRelease } from '../runtime/update-channel';
import type { UpdateChannel } from '../runtime/update-channel';
import {
  newestSquirrelPackages,
  parseSquirrelReleases,
  readSquirrelDownloadPercent,
} from './squirrel-releases';

/** Who the app is, for the updater: where its releases live and what it calls itself. */
export interface AppUpdaterOptions {
  /** GitHub owner of the repository releases (and so updates) come from: 'ShowTrak'. */
  Owner: string;
  /** That repository: 'ShowTrakServer', 'ShowTrakTimers'. */
  Repo: string;
  /** User-Agent for the GitHub API requests (release lists and notes): 'ShowTrakServer'. */
  UserAgent: string;
  /**
   * File name, in the OS temp folder, for the app-update.yml written when the
   * packaged one is missing: 'showtrak-app-update.yml'. One file per app,
   * rewritten each launch, rather than one per process left behind.
   */
  TempConfigName: string;
  /** The app's `CreateLogger('AppUpdater')`. */
  Logger: AppLoggerLike;
}

/**
 * The invoke registrar Register() wires the two channels on: the app's RPC
 * object, of which only `handle` is used.
 */
export interface AppUpdateRegistrar {
  handle(channel: 'AppUpdate:Check' | 'AppUpdate:Install', fn: () => Promise<void>): unknown;
}

/** The window status is pushed to: a BrowserWindow, of which only this is used. */
export interface AppUpdateStatusWindow {
  isDestroyed(): boolean;
  webContents: { send(channel: string, ...args: unknown[]): void };
}

export interface AppUpdaterRegisterOptions {
  /** The current main window (it is created lazily, and may be gone). */
  getMainWindow?: () => AppUpdateStatusWindow | null;
}

export interface AppUpdaterManager {
  /**
   * Wire 'AppUpdate:Check' and 'AppUpdate:Install', and the window status goes
   * to. electron-updater is not loaded here (see the file comment).
   */
  Register(RPC: AppUpdateRegistrar, options?: AppUpdaterRegisterOptions): void;
  /**
   * What to run just before an install quits the app: lets that quit past the
   * app's shutdown guard. Electron's Windows updater never emits
   * 'before-quit-for-update' (macOS's does), so the Squirrel install calls this
   * itself before it quits. If the hook returns a promise, the Squirrel install
   * waits for it (up to BEFORE_QUIT_FOR_UPDATE_TIMEOUT_MS) before handing over:
   * the installer starts the new version straight away, so the app's own
   * cleanup (closing its database) has to be finished by then.
   */
  SetBeforeQuitForUpdate(Hook: () => void | Promise<void>): void;
  /** Record a status and push it to the renderer. */
  sendAppUpdateStatus(payload: AppUpdateStatus): void;
  /** Whether this is a Squirrel-installed Windows build (Update.exe beside it). */
  isSquirrelWindows(): boolean;
  /**
   * The SYSTEM_AUTO_UPDATE_ENABLED setting. While enabled, a packaged build
   * checks in the background a minute after it is turned on and then every
   * four hours; whatever it downloads is installed on the next restart. It
   * never restarts the app itself: that is always the operator's call,
   * mid-show. Unpackaged runs and Linux packages never check automatically.
   */
  SetAutomaticUpdates(Enabled: boolean): void;
  /** The SYSTEM_UPDATE_CHANNEL setting; applies from the next check. */
  SetUpdateChannel(Value: unknown): void;
}

const CHECK_TIMEOUT_MS = 20000;
const SQUIRREL_META_TIMEOUT_MS = 8000;
const SQUIRREL_PROGRESS_INTERVAL_MS = 500;
const AUTO_CHECK_INITIAL_DELAY_MS = 60 * 1000;
const AUTO_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

const LINUX_UPDATES_UNAVAILABLE_MESSAGE =
  'In-app updates are not available for Linux packages. Download the new version from the GitHub releases page.';

// Linux packages (zip, deb, rpm) cannot update in place; only an AppImage
// could, and none is published. electron-updater's Linux updater does nothing
// at all outside an AppImage (no events, no error), so a check would only ever
// end in the watchdog's "timed out".
function linuxUpdatesUnavailable(): boolean {
  return process.platform === 'linux' && !process.env.APPIMAGE;
}

function toErrorMessage(value: unknown): string {
  if (!value) return 'Unknown error';
  if (value instanceof Error) return value.message || String(value);
  return String(value);
}

// How long a Squirrel install waits for the app's before-quit-for-update hook.
// A backstop only: the app bounds its own cleanup well inside this.
export const BEFORE_QUIT_FOR_UPDATE_TIMEOUT_MS = 45_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve(promise)
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

/** Turn an electron-updater failure into the status the renderer explains. */
function normalizeUpdaterError(err: unknown): AppUpdateStatus {
  const message = toErrorMessage(err);
  const isMac = process.platform === 'darwin';
  // electron-updater words a 404 several ways ("status 404", "HttpError: 404"),
  // so any standalone 404 counts. Matching only "status 404" (as ShowTrak Server
  // did) let a Stable-channel Mac check against a release with no macOS build
  // (Timers 1.x was Windows-only) surface a raw HttpError instead of "up to date".
  const has404 = /\b404\b/.test(message);
  const referencesManifest = message.includes('latest-mac.yml');
  const referencesReleaseZip =
    message.includes('Cannot download') &&
    message.includes('/releases/download/') &&
    message.includes('.zip');
  const referencesShipIt = message.includes('ShipIt');
  const referencesSignatureValidation =
    message.includes('did not pass validation') &&
    message.includes('code failed to satisfy specified code requirement');

  if (isMac && has404 && referencesManifest) {
    return {
      state: 'none',
      info: { reason: 'latest-mac.yml is missing from release assets' },
    };
  }

  // Releases carry no latest-linux.yml (they ship zip/deb/rpm, which the
  // updater cannot install in place), so say what to do instead of a raw 404.
  if (process.platform === 'linux' && has404 && message.includes('latest-linux.yml')) {
    return {
      state: 'error',
      error: LINUX_UPDATES_UNAVAILABLE_MESSAGE,
      info: { reason: 'linux_updates_unavailable', details: message },
    };
  }

  if (isMac && has404 && referencesReleaseZip) {
    return {
      state: 'error',
      error:
        'macOS update package is missing from this GitHub release (asset filename mismatch). Regenerate latest-mac.yml and upload a matching macOS zip asset.',
      info: {
        reason: 'mac_release_asset_name_mismatch',
        details: message,
      },
    };
  }

  if (isMac && referencesShipIt && referencesSignatureValidation) {
    return {
      state: 'error',
      error:
        'The downloaded macOS update failed signature validation. The installed app and update must be signed with the same Developer ID identity (same Team ID), and unsigned builds cannot auto-update.',
      info: {
        reason: 'mac_code_signature_requirement_mismatch',
        details: message,
      },
    };
  }

  return { state: 'error', error: message };
}

// Squirrel install root (the folder holding Update.exe and packages/), or null
// when this is not a Squirrel-installed Windows build.
function getSquirrelRootDir(): string | null {
  try {
    if (process.platform !== 'win32') return null;
    const execDir = path.dirname(process.execPath);
    for (const rootDir of [path.resolve(execDir, '..'), path.resolve(execDir, '..', '..')]) {
      if (fs.existsSync(path.join(rootDir, 'Update.exe'))) return rootDir;
    }
    return null;
  } catch {
    return null;
  }
}

function isSquirrelWindows(): boolean {
  return getSquirrelRootDir() !== null;
}

/**
 * Create the app's updater. Call once, when the app's updater module loads;
 * the returned object is what the app exports as its updater Manager.
 */
export function CreateAppUpdater(Options: AppUpdaterOptions): AppUpdaterManager {
  const { Owner, Repo, UserAgent, TempConfigName, Logger } = Options;
  const SQUIRREL_FEED_URL = `https://github.com/${Owner}/${Repo}/releases/latest/download/`;
  const GITHUB_RELEASE_BY_TAG_API = `https://api.github.com/repos/${Owner}/${Repo}/releases/tags/`;

  let autoUpdater: AppUpdater | null = null;
  let squirrelUpdaterInitialized = false;
  let getMainWindow: () => AppUpdateStatusWindow | null = () => null;
  let checkWatchdogTimer: NodeJS.Timeout | null = null;
  let hasDownloadedUpdate = false;
  let cachedMacDeveloperIdSigned: boolean | null = null;
  // The most recent status sent to the renderer, and the release info of the
  // update currently being fetched. A check requested while one is already in
  // flight replays these instead of restarting the updater mid-download.
  let lastStatus: AppUpdateStatus | null = null;
  let activeInfo: AppUpdateInfo | null = null;
  // Bumped whenever a Squirrel check starts or finishes so in-flight metadata
  // fetches and progress polls from an earlier cycle stop reporting.
  let squirrelSession = 0;
  let squirrelProgressTimer: NodeJS.Timeout | null = null;
  let squirrelReleaseInfo: { version?: string; releaseNotes?: string } | null = null;
  let automaticUpdatesEnabled = false;
  // Stable keeps the original behaviour (the GitHub "latest" release). Beta
  // resolves the newest release of any kind (see ../runtime/update-channel) and
  // points the updater at that release's own files.
  let updateChannel: UpdateChannel = 'stable';
  // The Squirrel feed the current check uses (RELEASES is read from it too).
  let activeSquirrelFeed = SQUIRREL_FEED_URL;
  // The GitHub tag of the beta channel's release, when this check uses one. The
  // Squirrel package rewrites a pre-release version ("3.32.0-beta1"), so the
  // tag cannot be rebuilt from it to fetch the release notes.
  let activeSquirrelTag: string | null = null;
  // Whether electron-updater was pointed at a specific release by the beta
  // channel, so a later stable check knows to point it back at GitHub.
  let usingChannelFeed = false;
  let autoCheckInitialTimer: NodeJS.Timeout | null = null;
  let autoCheckIntervalTimer: NodeJS.Timeout | null = null;
  // Set while an install is under way, so a second click does not start another.
  let installInFlight = false;
  let beforeQuitForUpdate: () => void | Promise<void> = () => undefined;

  const githubHeaders = () => ({
    Accept: 'application/vnd.github+json',
    'User-Agent': UserAgent,
  });

  // Electron's net.fetch goes through the system proxy (as Squirrel and
  // electron-updater do); Node's fetch does not, so behind a venue's proxy the
  // beta-channel lookup and release notes would fail while the update itself works.
  async function fetchText(url: string, headers: Record<string, string> = {}): Promise<string> {
    const Fetch: (Url: string, Init: RequestInit) => Promise<Response> =
      net && typeof net.fetch === 'function' ? net.fetch : fetch;
    const res = await Fetch(url, {
      headers,
      signal: AbortSignal.timeout(SQUIRREL_META_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`GET ${url} failed with status ${res.status}`);
    return res.text();
  }

  // The feed for this check: the stable defaults, or the beta channel's release.
  // A beta lookup that fails falls back to stable rather than failing the check;
  // the updaters never downgrade, so that can only ever offer a newer build.
  async function resolveChannelFeed(): Promise<{ Tag: string; FeedURL: string } | null> {
    if (updateChannel !== 'beta') return null;
    try {
      const Release = await ResolveChannelRelease({
        Owner,
        Repo,
        Channel: 'beta',
        FetchJson: async (Url) => {
          const Body: unknown = JSON.parse(await fetchText(Url, githubHeaders()));
          return Body;
        },
      });
      if (Release) Logger.log(`Beta channel: checking against ${Release.Tag}`);
      else Logger.warn('Beta channel: no installable release found; using the stable feed');
      return Release;
    } catch (e) {
      Logger.warn('Beta channel lookup failed; using the stable feed:', e);
      return null;
    }
  }

  function clearCheckWatchdog(): void {
    if (!checkWatchdogTimer) return;
    clearTimeout(checkWatchdogTimer);
    checkWatchdogTimer = null;
  }

  function startCheckWatchdog(timeoutMs = CHECK_TIMEOUT_MS): void {
    clearCheckWatchdog();
    Logger.log(`Update check watchdog started (${timeoutMs}ms)`);
    checkWatchdogTimer = setTimeout(() => {
      checkWatchdogTimer = null;
      Logger.error('Update check watchdog timed out');
      sendAppUpdateStatus({
        state: 'error',
        error: 'Update check timed out. Please try again in a moment.',
        info: { reason: 'check_timeout' },
      });
    }, timeoutMs);
  }

  function runSimulatedCheck(versionLabel: string): void {
    sendAppUpdateStatus({ state: 'checking', simulated: true });
    setTimeout(
      () =>
        sendAppUpdateStatus({
          state: 'available',
          info: { version: versionLabel },
          simulated: true,
        }),
      600
    );
    let pct = 0;
    const timer = setInterval(() => {
      pct += 14;
      if (pct >= 100) {
        clearInterval(timer);
        sendAppUpdateStatus({
          state: 'downloaded',
          info: { version: versionLabel },
          simulated: true,
        });
      } else {
        sendAppUpdateStatus({ state: 'downloading', percent: pct, simulated: true });
      }
    }, 250);
  }

  function runSimulatedInstall(): void {
    sendAppUpdateStatus({ state: 'installing', simulated: true });
    setTimeout(() => sendAppUpdateStatus({ state: 'installed', simulated: true }), 600);
  }

  function isUpdateInProgress(): boolean {
    const state = lastStatus && lastStatus.state;
    return (
      state === 'checking' ||
      state === 'available' ||
      state === 'downloading' ||
      state === 'installing'
    );
  }

  function forwardToRenderer(payload: AppUpdateStatus): void {
    try {
      const MainWindow = getMainWindow();
      if (MainWindow && !MainWindow.isDestroyed()) {
        MainWindow.webContents.send('AppUpdate:Status', payload);
      }
    } catch {
      /* intentional: forwarding status to a closing window is best-effort */
    }
  }

  function sendAppUpdateStatus(payload: AppUpdateStatus): void {
    const state = payload && payload.state;
    if (state === 'checking') {
      activeInfo = null;
    } else if (state === 'available' && payload.info) {
      activeInfo = payload.info;
    } else if (state === 'downloading' && !payload.info && activeInfo) {
      // Carry the release info on progress ticks so a late listener (the floating
      // progress bar, a reloaded window) can still name the version.
      payload = { ...payload, info: activeInfo };
    }
    lastStatus = payload;
    try {
      if (state) {
        Logger.log(`Updater status: ${state}`);
      }
    } catch {
      /* intentional: status logging is best-effort */
    }
    if (state === 'error') installInFlight = false;
    if (state === 'downloaded') {
      hasDownloadedUpdate = true;
    } else if (
      state === 'checking' ||
      state === 'available' ||
      state === 'downloading' ||
      state === 'none' ||
      state === 'error' ||
      state === 'installed'
    ) {
      hasDownloadedUpdate = false;
    }
    if (state === 'available' || state === 'none' || state === 'error' || state === 'downloaded') {
      clearCheckWatchdog();
    }
    forwardToRenderer(payload);
  }

  function isMacDeveloperIdSignedBuild(): boolean {
    if (process.platform !== 'darwin') return true;
    if (cachedMacDeveloperIdSigned !== null) return cachedMacDeveloperIdSigned;

    const probe = spawnSync('/usr/bin/codesign', ['-dv', '--verbose=4', process.execPath], {
      encoding: 'utf8',
    });

    // codesign writes signature metadata to stderr on success for -d/-v flags.
    const details = `${String(probe.stdout || '')}\n${String(probe.stderr || '')}`;
    const hasDeveloperIdAuthority = /Authority=Developer ID Application:/i.test(details);
    const hasTeamIdentifier = /TeamIdentifier=/i.test(details);

    if (probe.error) {
      Logger.warn(
        'codesign probe failed; allowing updater eligibility check to continue:',
        probe.error
      );
      cachedMacDeveloperIdSigned = true;
      return cachedMacDeveloperIdSigned;
    }

    if (hasDeveloperIdAuthority) {
      cachedMacDeveloperIdSigned = true;
      return cachedMacDeveloperIdSigned;
    }

    if (probe.status === 0 && hasTeamIdentifier) {
      Logger.warn(
        'codesign output has TeamIdentifier but no Developer ID authority text; treating build as eligible to avoid false negatives'
      );
      cachedMacDeveloperIdSigned = true;
      return cachedMacDeveloperIdSigned;
    }

    const authorityLines = details
      .split('\n')
      .filter((line: string) => line.trim().startsWith('Authority='))
      .join(' | ');
    Logger.warn(
      `codesign probe indicates no Developer ID authority. status=${probe.status}; authorities=${authorityLines || 'none'}`
    );
    cachedMacDeveloperIdSigned = false;

    return cachedMacDeveloperIdSigned;
  }

  function ensureMacAutoUpdateEligibility(): boolean {
    if (process.platform !== 'darwin') return true;
    if (isMacDeveloperIdSignedBuild()) return true;

    sendAppUpdateStatus({
      state: 'error',
      error:
        'This macOS app build is not Developer ID signed, so automatic updates are disabled. Install an official signed release build to use in-app updates.',
      info: { reason: 'mac_unsigned_build_no_auto_update' },
    });
    return false;
  }

  function endSquirrelTracking(): void {
    squirrelSession++;
    if (squirrelProgressTimer) {
      clearInterval(squirrelProgressTimer);
      squirrelProgressTimer = null;
    }
  }

  // Squirrel's 'update-available' carries no details, so read the version and
  // package sizes from the feed's RELEASES manifest, then poll the package file
  // Squirrel is writing to report real download progress.
  async function trackSquirrelDownload(session: number): Promise<void> {
    let packages: ReturnType<typeof newestSquirrelPackages> = [];
    try {
      packages = newestSquirrelPackages(
        parseSquirrelReleases(await fetchText(`${activeSquirrelFeed}RELEASES`))
      );
    } catch (e) {
      Logger.warn('Failed to read Squirrel RELEASES manifest; progress unavailable:', e);
    }
    const version = packages[0]?.version;
    if (session !== squirrelSession || !version) return;

    let releaseNotes: string | undefined;
    try {
      const release: unknown = JSON.parse(
        await fetchText(
          `${GITHUB_RELEASE_BY_TAG_API}${activeSquirrelTag || `v${version}`}`,
          githubHeaders()
        )
      );
      if (IsRecord(release) && typeof release.body === 'string') releaseNotes = release.body;
    } catch (e) {
      Logger.warn(`Failed to fetch release notes for v${version}:`, e);
    }
    if (session !== squirrelSession) return;

    squirrelReleaseInfo = { version, releaseNotes };
    sendAppUpdateStatus({ state: 'available', info: squirrelReleaseInfo });

    const rootDir = getSquirrelRootDir();
    if (!rootDir) return;
    let lastPct = -1;
    const tick = () => {
      if (session !== squirrelSession) return;
      const pct = Math.floor(readSquirrelDownloadPercent(rootDir, packages) ?? 0);
      if (pct === lastPct) return;
      lastPct = pct;
      sendAppUpdateStatus({ state: 'downloading', percent: pct });
    };
    tick();
    squirrelProgressTimer = setInterval(tick, SQUIRREL_PROGRESS_INTERVAL_MS);
  }

  function initSquirrelUpdater(): void {
    if (squirrelUpdaterInitialized) return;
    squirrelUpdaterInitialized = true;
    try {
      SquirrelUpdater.on('checking-for-update', () => sendAppUpdateStatus({ state: 'checking' }));
      SquirrelUpdater.on('update-available', () => {
        sendAppUpdateStatus({ state: 'available' });
        void trackSquirrelDownload(squirrelSession);
      });
      SquirrelUpdater.on('update-not-available', () => {
        endSquirrelTracking();
        sendAppUpdateStatus({ state: 'none' });
      });
      SquirrelUpdater.on(
        'update-downloaded',
        (_e: unknown, _notes: unknown, _name: unknown, _date: unknown, _url: unknown) => {
          endSquirrelTracking();
          const version = (_name ? String(_name) : '') || squirrelReleaseInfo?.version;
          sendAppUpdateStatus({ state: 'downloaded', info: { ...squirrelReleaseInfo, version } });
        }
      );
      SquirrelUpdater.on('error', (err: unknown) => {
        endSquirrelTracking();
        sendAppUpdateStatus({ state: 'error', error: String(err) });
      });
    } catch {
      /* intentional: the Squirrel updater is unavailable in dev/unpackaged runs; wiring it is best-effort */
    }
  }

  async function handleCheck(): Promise<void> {
    Logger.log('AppUpdate:Check invoked');

    // Already checking or downloading: restarting the updater would error, so
    // just re-send where the current run is up to.
    if (isUpdateInProgress() && lastStatus) {
      Logger.log(`AppUpdate:Check skipped; update already ${lastStatus.state}`);
      forwardToRenderer(lastStatus);
      return;
    }
    // Downloaded and waiting for a restart: a new check would report "up to
    // date" (Squirrel already lists the new version) and hide the Install button.
    if (hasDownloadedUpdate && lastStatus) {
      Logger.log('AppUpdate:Check skipped; an update is downloaded and ready to install');
      forwardToRenderer(lastStatus);
      return;
    }

    if (app.isPackaged && linuxUpdatesUnavailable()) {
      sendAppUpdateStatus({
        state: 'error',
        error: LINUX_UPDATES_UNAVAILABLE_MESSAGE,
        info: { reason: 'linux_updates_unavailable' },
      });
      return;
    }

    if (app.isPackaged && !ensureMacAutoUpdateEligibility()) {
      Logger.warn('AppUpdate:Check continuing despite macOS signing eligibility warning');
    }

    sendAppUpdateStatus({ state: 'checking' });
    startCheckWatchdog();

    // Dev/unpacked: simulate
    if (!app.isPackaged) {
      try {
        Logger.log('Running simulated update check (unpackaged app)');
        runSimulatedCheck('TEST');
      } catch (e) {
        sendAppUpdateStatus({ state: 'error', error: String(e) });
      }
      return;
    }

    // Packaged on Windows via Squirrel: Electron's built-in Squirrel updater against GitHub.
    if (isSquirrelWindows()) {
      try {
        Logger.log('Using Squirrel updater check flow');
        initSquirrelUpdater();
        endSquirrelTracking();
        squirrelReleaseInfo = null;
        const ChannelFeed = await resolveChannelFeed();
        activeSquirrelFeed = ChannelFeed ? ChannelFeed.FeedURL : SQUIRREL_FEED_URL;
        activeSquirrelTag = ChannelFeed ? ChannelFeed.Tag : null;
        // Try both object and string forms for compatibility
        try {
          SquirrelUpdater.setFeedURL({ url: activeSquirrelFeed });
        } catch {
          // The string form older Electron releases took, which Electron still
          // accepts at runtime but its typings no longer describe.
          const LegacyUpdater: { setFeedURL(Feed: string | FeedURLOptions): void } =
            SquirrelUpdater;
          LegacyUpdater.setFeedURL(activeSquirrelFeed);
        }
        SquirrelUpdater.checkForUpdates();
      } catch (e) {
        sendAppUpdateStatus({ state: 'error', error: String(e) });
      }
      return;
    }

    // Packaged (non-Squirrel): ensure electron-updater is initialized
    if (!autoUpdater) {
      try {
        // Required here, on first use: it is large, and most launches never need
        // it (the apps' main bundles keep it external; see scripts/build-main.js).
        const { autoUpdater: updater } =
          require('electron-updater') as typeof import('electron-updater');
        autoUpdater = updater;
        Logger.log('Initialized electron-updater in handleCheck()');
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = automaticUpdatesEnabled;
        autoUpdater.on('checking-for-update', () => sendAppUpdateStatus({ state: 'checking' }));
        autoUpdater.on('update-available', (info: UpdateInfo) =>
          sendAppUpdateStatus({ state: 'available', info })
        );
        autoUpdater.on('update-not-available', (info: UpdateInfo) =>
          sendAppUpdateStatus({ state: 'none', info })
        );
        autoUpdater.on('error', (err: unknown) => sendAppUpdateStatus(normalizeUpdaterError(err)));
        autoUpdater.on('download-progress', (p: { percent?: number }) =>
          sendAppUpdateStatus({ state: 'downloading', percent: p && p.percent ? p.percent : 0 })
        );
        autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
          sendAppUpdateStatus({ state: 'downloaded', info })
        );
      } catch (e) {
        sendAppUpdateStatus({ state: 'error', error: 'Updater init failed: ' + String(e) });
        return;
      }
    }

    // Try to find an app-update.yml; if missing, synthesize one for GitHub public repo
    const resourcesPath =
      typeof process !== 'undefined' ? (process as { resourcesPath?: string }).resourcesPath : '';
    const execDir =
      typeof process !== 'undefined' && process.execPath ? path.dirname(process.execPath) : '';
    const ymlPaths = [
      resourcesPath ? path.join(resourcesPath, 'app-update.yml') : '',
      execDir ? path.join(execDir, 'app-update.yml') : '',
    ].filter(Boolean);
    const hasYml = ymlPaths.some((p: string) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    });
    if (!hasYml) {
      try {
        const tmpYml = path.join(os.tmpdir(), TempConfigName);
        const yml = [
          'provider: github',
          `owner: ${Owner}`,
          `repo: ${Repo}`,
          // no token for public repo; add one via env GH_TOKEN if rate-limited
        ].join('\n');
        fs.writeFileSync(tmpYml, yml, 'utf8');
        autoUpdater.updateConfigPath = tmpYml;
        Logger.warn(`app-update.yml not found; using temporary updater config at ${tmpYml}`);
      } catch (e) {
        sendAppUpdateStatus({
          state: 'error',
          error: 'Failed to create app-update.yml for the packaged app.',
          info: { details: String(e || 'Unknown error') },
        });
        return;
      }
    } else {
      Logger.log('Using packaged app-update.yml config for updater');
    }

    // Channel: beta points the updater at the chosen release's own files
    // (latest-mac.yml); stable uses GitHub's "latest" release and never offers a
    // pre-release, even when the installed build is itself a beta.
    const ChannelFeed = await resolveChannelFeed();
    try {
      if (ChannelFeed) {
        autoUpdater.setFeedURL({ provider: 'generic', url: ChannelFeed.FeedURL });
        usingChannelFeed = true;
      } else if (usingChannelFeed) {
        autoUpdater.setFeedURL({ provider: 'github', owner: Owner, repo: Repo });
        usingChannelFeed = false;
      }
      autoUpdater.allowPrerelease = false;
    } catch (e) {
      Logger.warn('Failed to apply the update channel; checking with the default feed:', e);
    }

    try {
      await withTimeout(autoUpdater.checkForUpdates(), CHECK_TIMEOUT_MS, 'checkForUpdates');
      Logger.log('checkForUpdates() returned');
    } catch (e) {
      Logger.error('checkForUpdates() failed:', e);
      sendAppUpdateStatus(normalizeUpdaterError(e));
    }
  }

  async function handleInstall(): Promise<void> {
    Logger.log('AppUpdate:Install invoked');

    if (app.isPackaged && !ensureMacAutoUpdateEligibility()) {
      Logger.warn('AppUpdate:Install blocked by macOS signing eligibility guard');
      return;
    }

    // Dev/unpacked: simulate install
    if (!app.isPackaged) {
      try {
        Logger.log('Running simulated update install (unpackaged app)');
        runSimulatedInstall();
      } catch (e) {
        sendAppUpdateStatus({ state: 'error', error: String(e) });
      }
      return;
    }

    // Packaged on Windows via Squirrel: call built-in updater
    if (isSquirrelWindows()) {
      try {
        Logger.log('Using Squirrel updater install flow');
        sendAppUpdateStatus({ state: 'installing' });
        try {
          await withTimeout(
            Promise.resolve(beforeQuitForUpdate()),
            BEFORE_QUIT_FOR_UPDATE_TIMEOUT_MS,
            'Preparing to quit for the update'
          );
        } catch (e) {
          // Install anyway: a cleanup that failed or hangs must not block the update.
          Logger.error('Preparing to quit for the update failed:', e);
        }
        SquirrelUpdater.quitAndInstall();
      } catch (e) {
        sendAppUpdateStatus({ state: 'error', error: String(e) });
      }
      return;
    }

    // Only install after a successful check/download cycle in this app session.
    if (!autoUpdater || !hasDownloadedUpdate) {
      Logger.warn('Install requested without downloaded update in current session');
      sendAppUpdateStatus({
        state: 'error',
        error: 'No downloaded update is ready to install. Run check/download again before install.',
      });
      return;
    }
    // On macOS the native updater still has to fetch the package before it can
    // quit, which takes a moment: say so, and ignore further clicks meanwhile.
    if (installInFlight) {
      Logger.log('AppUpdate:Install ignored; an install is already under way');
      return;
    }
    installInFlight = true;
    try {
      sendAppUpdateStatus({ state: 'installing' });
      Logger.log('Calling electron-updater quitAndInstall(false, true)');
      await autoUpdater.quitAndInstall(false, true);
    } catch (e) {
      installInFlight = false;
      Logger.error('quitAndInstall failed:', e);
      sendAppUpdateStatus({ state: 'error', error: String(e) });
    }
  }

  function runAutomaticCheck(): void {
    if (!automaticUpdatesEnabled) return;
    // Nothing more to fetch until the downloaded update has been installed.
    if (hasDownloadedUpdate) return;
    Logger.log('Running automatic background update check');
    handleCheck().catch((e: unknown) => Logger.error('Automatic update check failed:', e));
  }

  function clearAutomaticCheckTimers(): void {
    if (autoCheckInitialTimer) clearTimeout(autoCheckInitialTimer);
    if (autoCheckIntervalTimer) clearInterval(autoCheckIntervalTimer);
    autoCheckInitialTimer = null;
    autoCheckIntervalTimer = null;
  }

  return {
    Register(RPC, options = {}) {
      if (typeof options.getMainWindow === 'function') {
        getMainWindow = options.getMainWindow;
      }
      RPC.handle('AppUpdate:Check', handleCheck);
      RPC.handle('AppUpdate:Install', handleInstall);
    },
    SetBeforeQuitForUpdate(Hook) {
      beforeQuitForUpdate = Hook;
    },
    sendAppUpdateStatus,
    isSquirrelWindows,
    SetAutomaticUpdates(Enabled) {
      const Next = !!Enabled && app.isPackaged && !linuxUpdatesUnavailable();
      if (autoUpdater) autoUpdater.autoInstallOnAppQuit = Next;
      if (Next === automaticUpdatesEnabled) return;
      automaticUpdatesEnabled = Next;
      clearAutomaticCheckTimers();
      if (!Next) {
        Logger.log('Automatic updates disabled');
        return;
      }
      Logger.log('Automatic updates enabled');
      autoCheckInitialTimer = setTimeout(() => {
        autoCheckInitialTimer = null;
        runAutomaticCheck();
      }, AUTO_CHECK_INITIAL_DELAY_MS);
      autoCheckIntervalTimer = setInterval(runAutomaticCheck, AUTO_CHECK_INTERVAL_MS);
    },
    SetUpdateChannel(Value) {
      const Next = NormalizeUpdateChannel(Value);
      if (Next === updateChannel) return;
      updateChannel = Next;
      Logger.log(`Update channel: ${Next}`);
    },
  };
}
