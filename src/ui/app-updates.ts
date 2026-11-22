// @showtrak/protocol/ui/app-updates: the Software Update modal of ShowTrak
// Server and ShowTrak Timers (#SHOWTRAK_MODAL_APP_UPDATE, the same markup in
// both apps).
//
// The manual entry points (a menu's "Check for Updates", the About modal's
// button) open the modal and kick off a check; the live OnAppUpdateStatus
// listener then updates the headline, download progress ring, action buttons
// and rendered changelog. GitHub release notes arrive as either HTML (run
// through the allowlist sanitizer) or Markdown (rendered via the safe
// renderer). While a check or download is in flight, reopening the modal shows
// its progress rather than starting another, and a floating progress bar
// (#APP_UPDATE_FLOAT) tracks it whenever the modal is closed.
//
// What differs between the apps is passed to CreateAppUpdates: the app's name
// in the messages, its icon style, which buttons open the modal, its preload
// API, how it closes its other modals, and anything it adds to the modal as it
// opens (Timers' update-channel note).
import type { AppUpdateStatus } from '@showtrak/protocol';
import { HandleNonFatalError } from './errors';
import { StyledGlyph, type IconStyle } from './icons';
import { renderMarkdownSafe, sanitizeUpdateNotesHtml } from './markdown';

/** The part of an app's preload API (`window.API`) the modal uses. */
export interface AppUpdatesApi {
  CheckForAppUpdates(): Promise<unknown>;
  InstallAppUpdate(): Promise<unknown>;
  OnAppUpdateStatus(Callback: (Status: AppUpdateStatus) => void): unknown;
}

/** What an app passes to CreateAppUpdates. */
export interface AppUpdatesOptions {
  /** The app as the messages name it: 'ShowTrak Server', 'ShowTrak Timers'. */
  ProductName: string;
  /** The status icons' style: Server 'outline', Timers 'fill'. */
  IconStyle: IconStyle;
  /**
   * Ids of the buttons that open the modal and start a check, wired by
   * wireAppUpdates. Server: its menu entry and the About modal's button; Timers
   * only the About modal's (its menu wires its own entry, see OpenAppUpdateModal).
   */
  OpenButtonIds: readonly string[];
  /** The preload API, read each time it is used (`() => window.API`). */
  Api: () => AppUpdatesApi;
  /** Closes the app's other modals before the update modal opens. */
  CloseAllModals: () => unknown;
  /** Runs each time the modal opens, before it shows (Timers writes its channel note). */
  OnOpen?: () => void;
}

/** The modal's functions for one app (see CreateAppUpdates). */
export interface AppUpdates {
  /** Wire the buttons and start listening for the updater's status. Once, at boot. */
  wireAppUpdates(): void;
  /**
   * Open the Software Update modal and (by default) start a check. A run that is
   * already in flight is shown as-is instead of being restarted.
   */
  OpenAppUpdateModal(runCheck?: boolean): Promise<void>;
}

export const APP_UPDATE_MODAL_ID = 'SHOWTRAK_MODAL_APP_UPDATE';

// Circumference of the progress ring (2·π·r, r=22); matches the SVG/CSS.
const RING_CIRCUMFERENCE = 2 * Math.PI * 22;

function isInProgress(status: AppUpdateStatus | null): boolean {
  const st = status && status.state;
  return st === 'checking' || st === 'available' || st === 'downloading';
}

/** A version as the modal shows it: with a leading 'v' ('3.2.0' -> 'v3.2.0'). */
export function FormatUpdateVersion(version: unknown): string {
  const label = version ? String(version) : '';
  return label && !/^v/i.test(label) ? `v${label}` : label;
}

function downloadPercent(status: AppUpdateStatus): number {
  return status.percent ? Math.max(0, Math.min(100, Math.floor(status.percent))) : 0;
}

/**
 * A status's release notes, whichever shape electron-updater ships them in: a
 * string under releaseNotes, notes or body, or (macOS) a list of releases, of
 * which the first entry's notes are taken. '' when there are none.
 */
export function ExtractReleaseNotes(info: AppUpdateStatus['info']): unknown {
  if (!info) return '';
  const raw = info.releaseNotes || info.notes || info.body || '';
  if (Array.isArray(raw)) {
    const first: unknown = (raw as readonly unknown[]).find(Boolean);
    if (typeof first !== 'object' || first === null) return '';
    const entry = first as Record<string, unknown>;
    return entry.releaseNotes || entry.notes || entry.body || '';
  }
  return raw || '';
}

/**
 * The Software Update modal for one app. Call it once, in the app's own
 * wire-app-updates module, and re-export what it returns. Touches nothing until
 * wireAppUpdates or OpenAppUpdateModal runs.
 */
export function CreateAppUpdates(Options: AppUpdatesOptions): AppUpdates {
  const MODAL_ID = APP_UPDATE_MODAL_ID;
  const Done = StyledGlyph('bi-check-circle', Options.IconStyle);
  const Failed = StyledGlyph('bi-exclamation-triangle', Options.IconStyle);

  // The most recent status from main, and the version of the update in flight.
  let latestStatus: AppUpdateStatus | null = null;
  let activeVersion = '';

  // Set the hero icon (a Bootstrap Icons glyph), optionally spinning it.
  function setIcon(icon: string, spin = false) {
    $('#APP_UPDATE_ICON').attr('class', `bi ${icon}${spin ? ' SHOWTRAK_APP_UPDATE_SPIN' : ''}`);
  }

  // Show/fill (or hide) the circular progress ring around the hero icon. Passing
  // null hides the ring; a percent reveals it and fills the arc.
  function setProgress(percent: number | null) {
    const $wrap = $('#APP_UPDATE_ICON_WRAP');
    if (percent == null) {
      $wrap.removeClass('has-progress');
      return;
    }
    const pct = Math.max(0, Math.min(100, Math.floor(percent)));
    const offset = RING_CIRCUMFERENCE * (1 - pct / 100);
    $wrap.addClass('has-progress');
    $('#APP_UPDATE_RING_BAR').css('stroke-dashoffset', String(offset));
  }

  // Set the coloured version pill next to the headline (hidden when empty).
  function setVersionBadge(version: unknown) {
    const $badge = $('#APP_UPDATE_VERSION');
    const label = version ? String(version) : '';
    if (!label) {
      $badge.addClass('d-none').text('');
      return;
    }
    $badge.removeClass('d-none').text(FormatUpdateVersion(label));
  }

  // Render the changelog into the notes panel (or hide it when there's nothing).
  // HTML notes are sanitized; Markdown notes go through the safe renderer.
  function showNotes(info: AppUpdateStatus['info']) {
    const $wrap = $('#APP_UPDATE_NOTES_WRAPPER');
    const $notes = $('#APP_UPDATE_CHANGELOG');
    const notes = ExtractReleaseNotes(info);
    if (!notes || typeof notes !== 'string') {
      $wrap.addClass('d-none');
      $notes.empty();
      return;
    }
    const looksHtml = /<\w+[^>]*>/.test(notes);
    $notes.html(looksHtml ? sanitizeUpdateNotesHtml(notes) : renderMarkdownSafe(notes));
    const version = info && (info.version || info.tag);
    $('#APP_UPDATE_NOTES_VERSION').text(FormatUpdateVersion(version));
    $wrap.removeClass('d-none');
  }

  // Collapse the modal back to the neutral "checking" look before a fresh check.
  function resetToChecking() {
    setIcon('bi-arrow-repeat', true);
    $('#APP_UPDATE_STATUS').text('Checking for updates...');
    $('#APP_UPDATE_SUBTEXT').text('Contacting the update server.');
    setVersionBadge('');
    setProgress(null);
    $('#APP_UPDATE_NOTES_WRAPPER').addClass('d-none');
    $('#APP_UPDATE_CHANGELOG').empty();
    $('#APP_UPDATE_INSTALL_BTN').addClass('d-none');
  }

  // Show the floating "Software Update" bar while an update is downloading and
  // the modal itself is closed. Plain checks stay silent so the periodic
  // background check doesn't flash it up when there is nothing new.
  function renderFloatingProgress() {
    const $float = $('#APP_UPDATE_FLOAT');
    const modalOpen = $('#' + MODAL_ID).hasClass('show');
    const st = latestStatus && latestStatus.state;
    if (!latestStatus || (st !== 'available' && st !== 'downloading') || modalOpen) {
      $float.addClass('d-none');
      return;
    }
    const downloading = st === 'downloading';
    const pct = downloading ? downloadPercent(latestStatus) : 0;
    $('#APP_UPDATE_FLOAT_VERSION').text(FormatUpdateVersion(activeVersion));
    $('#APP_UPDATE_FLOAT_DETAIL').text(
      downloading ? `Downloading... ${pct}%` : 'Starting download...'
    );
    $('#APP_UPDATE_FLOAT_BAR')
      .toggleClass('is-indeterminate', !downloading)
      .css('width', downloading ? `${pct}%` : '');
    $('#APP_UPDATE_FLOAT_TRACK').attr('aria-valuenow', String(pct));
    $float.removeClass('d-none');
  }

  // Ask main for a fresh check, unless one is already running, in which case
  // the modal simply keeps showing that run's progress.
  async function startCheck() {
    if (isInProgress(latestStatus)) return;
    resetToChecking();
    try {
      await Options.Api().CheckForAppUpdates();
    } catch (err) {
      HandleNonFatalError('AppUpdate:Check', err);
    }
  }

  async function OpenAppUpdateModal(runCheck = true): Promise<void> {
    await Options.CloseAllModals();
    if (Options.OnOpen) Options.OnOpen();
    if (latestStatus && isInProgress(latestStatus)) {
      renderStatus(latestStatus);
    } else if (runCheck) {
      resetToChecking();
    }
    $('#' + MODAL_ID).modal('show');
    if (runCheck) await startCheck();
  }

  // Paint one updater status into the modal.
  function renderStatus(payload: AppUpdateStatus) {
    const st = (payload && payload.state) || 'none';
    const $status = $('#APP_UPDATE_STATUS');
    const $subtext = $('#APP_UPDATE_SUBTEXT');
    const $install = $('#APP_UPDATE_INSTALL_BTN');

    // Reset the transient bits every tick; each branch re-enables what it needs.
    $install.addClass('d-none');
    setProgress(null);

    if (st === 'checking') {
      setIcon('bi-arrow-repeat', true);
      $status.text('Checking for updates...');
      $subtext.text('Contacting the update server.');
      setVersionBadge('');
    } else if (st === 'available') {
      const v = payload.info && (payload.info.version || payload.info.tag);
      setIcon('bi-arrow-repeat', true);
      $status.text('Update available');
      $subtext.text('Downloading the latest release...');
      setVersionBadge(v);
      showNotes(payload.info);
    } else if (st === 'downloading') {
      const pct = downloadPercent(payload);
      setIcon('bi-arrow-repeat', true);
      $status.text('Downloading update...');
      $subtext.text(pct >= 100 ? 'Download complete. Preparing update...' : `${pct}% complete`);
      setProgress(pct);
      if (payload.info) {
        setVersionBadge(payload.info.version || payload.info.tag);
        showNotes(payload.info);
      }
    } else if (st === 'downloaded') {
      const v = payload.info && payload.info.version;
      setIcon(Done);
      $status.text('Update ready to install');
      $subtext.text(`Install now to restart ${Options.ProductName} on the new version.`);
      setVersionBadge(v);
      showNotes(payload.info);
      $install.removeClass('d-none');
    } else if (st === 'installing') {
      setIcon('bi-gear-wide-connected', true);
      $status.text('Installing update...');
      $subtext.text(`${Options.ProductName} will restart shortly.`);
    } else if (st === 'installed') {
      setIcon(Done);
      $status.text('Update installed');
      $subtext.text(
        payload.simulated
          ? 'Simulated install complete. Restart the app to finish.'
          : 'Restart the app to finish updating.'
      );
    } else if (st === 'none') {
      setIcon(Done);
      $status.text("You're up to date");
      $subtext.text(`You have the latest version of ${Options.ProductName}.`);
      setVersionBadge('');
    } else if (st === 'error') {
      setIcon(Failed);
      $status.text('Update failed');
      $subtext.text(payload.error || 'An unknown error occurred while checking for updates.');
    }
  }

  function wireAppUpdates(): void {
    try {
      // "Check for Updates" buttons: the app's menu entry, the About modal's.
      for (const Id of Options.OpenButtonIds) {
        $('#' + Id)
          .off('click')
          .on('click', () => OpenAppUpdateModal());
      }

      // Re-run a check from within the update modal.
      $('#APP_UPDATE_CHECK_BTN')
        .off('click')
        .on('click', () => startCheck());

      // Install & restart.
      $('#APP_UPDATE_INSTALL_BTN')
        .off('click')
        .on('click', async () => {
          try {
            await Options.Api().InstallAppUpdate();
          } catch (err) {
            HandleNonFatalError('AppUpdate:Install', err);
          }
        });

      // Close/dismiss.
      $('#APP_UPDATE_LATER_BTN')
        .off('click')
        .on('click', () => {
          $('#' + MODAL_ID).modal('hide');
        });

      // The floating bar opens the modal; it hides while the modal is up and
      // comes back if the modal is dismissed mid-download.
      $('#APP_UPDATE_FLOAT')
        .off('click')
        .on('click', () => OpenAppUpdateModal(false));
      $('#' + MODAL_ID)
        .off('show.bs.modal.appUpdate hidden.bs.modal.appUpdate')
        .on('show.bs.modal.appUpdate', () => $('#APP_UPDATE_FLOAT').addClass('d-none'))
        .on('hidden.bs.modal.appUpdate', () => renderFloatingProgress());

      // Listen for updater status from main.
      Options.Api().OnAppUpdateStatus((payload) => {
        try {
          latestStatus = payload || null;
          const st = payload && payload.state;
          const info = payload && payload.info;
          if (st === 'checking') activeVersion = '';
          const v = info && (info.version || info.tag);
          if (v) activeVersion = String(v);
          renderStatus(payload);
          renderFloatingProgress();
        } catch (err) {
          HandleNonFatalError('AppUpdate:Status', err);
        }
      });
    } catch (err) {
      HandleNonFatalError('AppUpdate:Wire', err);
    }
  }

  return { wireAppUpdates, OpenAppUpdateModal };
}
