// @showtrak/protocol/ui/toasts: the alert-style toasts of ShowTrak Server and
// ShowTrak Timers. Top-centre, stacked in #ALERTS_TOAST_HOST, auto-dismissed
// after a delay that pauses while the pointer is over the toast
// (`showAlertStyleToast`); `Notify` is the one-line form most callers use.
//
// What differs between the apps is passed to CreateToasts: the icon style
// (Server outline, Timers filled). A Server alert linked to its alerts tray
// passes its own icon and `onDismiss` on the call that shows it.
//
// The confirmation dialog is ./confirm-dialog. Server's critical confirmation
// and execution panel are its own and stay in the app.
import { HandleNonFatalError } from './errors';
import { Safe } from './html';
import { StyledGlyph, type IconStyle } from './icons';

/** Options accepted by `showAlertStyleToast`. */
export interface AlertStyleToastOptions {
  /** With `linkAlert`, tags the toast so `RemoveAlertToastById(id)` finds it. */
  id?: string | null;
  /** The bold first line ('Notice' when empty). Escaped. */
  title?: unknown;
  /** An optional second line. Escaped. */
  message?: unknown;
  /** 'success' | 'warning' | 'error' | 'info' (the default): the accent and icon. */
  type?: string;
  /** Milliseconds before it goes by itself; 0 or less keeps it until dismissed. */
  duration?: number;
  /** Tag the toast with `id` (Server: a toast mirroring an alerts-tray entry). */
  linkAlert?: boolean;
  /** Markup for the icon, in place of the type's own. Inserted as-is. */
  iconHtml?: string | null;
  /** Runs after the operator dismisses the toast with its ✕ (not when it times out). */
  onDismiss?: () => void;
}

/** The toast functions bound to one app's look (see CreateToasts). */
export interface Toasts {
  /** The icon markup for a toast type, in the app's style. */
  iconForType(type: unknown): string;
  showAlertStyleToast(options: AlertStyleToastOptions): void;
  /** A title-only toast, closed off as a sentence (see WithFullStop). */
  Notify(Message: unknown, Type?: string, Duration?: number): Promise<void>;
}

/**
 * Close a toast message off as a sentence. Literal messages are written with
 * their own full stop, but dynamic ones (errors handed back by the main process
 * or the server, labels joined at runtime) often are not. Messages already
 * ending in sentence punctuation are left alone, and non-strings pass through
 * untouched.
 */
export function WithFullStop(Message: unknown): unknown {
  if (typeof Message !== 'string') return Message;
  const Trimmed = Message.trimEnd();
  if (!Trimmed) return Message;
  return /[.!?…]$/.test(Trimmed) ? Trimmed : `${Trimmed}.`;
}

/** The element toasts stack in, created at the end of <body> the first time. */
export function ensureToastHost(): HTMLElement {
  let host = document.getElementById('ALERTS_TOAST_HOST');
  if (!host) {
    host = document.createElement('div');
    host.id = 'ALERTS_TOAST_HOST';
    document.body.appendChild(host);
  }
  return host;
}

/** Remove the toast shown with `linkAlert` for this id, if it is still up. */
export function RemoveAlertToastById(id: unknown): void {
  try {
    const host = document.getElementById('ALERTS_TOAST_HOST');
    if (!host) return;
    const node = host.querySelector(`.alert-toast[data-alert-id="${CSS.escape(String(id))}"]`);
    if (node) node.remove();
  } catch (e) {
    HandleNonFatalError('RemoveAlertToastById', e);
  }
}

// Auto-remove `el` after `duration` ms, pausing the countdown while the pointer
// hovers it. No-op for duration <= 0.
function attachHoverPauseDismiss(el: HTMLElement, duration: number): void {
  if (!duration || duration <= 0) return;
  let remaining = duration;
  let timerId: ReturnType<typeof setTimeout> | null = null;
  let lastStart = Date.now();
  const clear = () => {
    if (timerId) {
      clearTimeout(timerId);
      timerId = null;
    }
  };
  const remove = (context: string) => {
    try {
      el.remove();
    } catch (e) {
      HandleNonFatalError(context, e);
    }
  };
  const tick = () => {
    clear();
    lastStart = Date.now();
    timerId = setTimeout(() => remove('showAlertStyleToast:AutoRemove'), remaining);
  };
  el.addEventListener('mouseenter', () => {
    remaining -= Date.now() - lastStart;
    if (remaining < 0) remaining = 0;
    clear();
  });
  el.addEventListener('mouseleave', () => {
    if (remaining === 0) remove('showAlertStyleToast:MouseLeaveRemove');
    else tick();
  });
  tick();
}

/**
 * The toast functions for one app. Call it once, in the app's own toasts
 * module, and re-export what it returns: Server passes `{ IconStyle: 'outline' }`,
 * Timers `{ IconStyle: 'fill' }`. Touches nothing until a toast is shown.
 */
export function CreateToasts(Options: { IconStyle: IconStyle }): Toasts {
  const Style = Options.IconStyle;

  function iconForType(type: unknown): string {
    const t = String(type || 'info').toLowerCase();
    if (t === 'success') return `<i class="bi ${StyledGlyph('bi-check-circle', Style)}"></i>`;
    if (t === 'warning')
      return `<i class="bi ${StyledGlyph('bi-exclamation-triangle', Style)}"></i>`;
    if (t === 'error') return `<i class="bi ${StyledGlyph('bi-x-circle', Style)}"></i>`;
    return `<i class="bi ${StyledGlyph('bi-info-circle', Style)}"></i>`;
  }

  function showAlertStyleToast({
    id = null,
    title = '',
    message = '',
    type = 'info',
    duration = 5000,
    linkAlert = false,
    iconHtml = null,
    onDismiss,
  }: AlertStyleToastOptions): void {
    const host = ensureToastHost();
    const el = document.createElement('div');
    el.className = 'alert-item alert-toast';
    el.setAttribute('data-severity', String(type || 'info').toLowerCase());
    if (id && linkAlert) el.setAttribute('data-alert-id', id);
    const hasMessage = Boolean(message && String(message).trim().length > 0);
    if (!hasMessage) el.classList.add('single-line');
    el.innerHTML = `
		<div class="alert-icon">${iconHtml ? iconHtml : iconForType(type)}</div>
		<div class="alert-content">
			<div><strong>${Safe(title || 'Notice')}</strong></div>
			${message ? `<div class="alert-meta">${Safe(message)}</div>` : ''}
		</div>
		<div class="alert-dismiss">
			<button class="btn-dismiss" title="Dismiss" aria-label="Dismiss">✕</button>
		</div>`;
    host.appendChild(el);

    // Dismiss interaction
    const btn = el.querySelector('.btn-dismiss');
    if (btn)
      btn.addEventListener('click', () => {
        el.remove();
        if (onDismiss) onDismiss();
      });

    // Auto-remove after duration with hover pause
    attachHoverPauseDismiss(el, duration);
  }

  // Every toast reads as a sentence: dynamic messages (errors handed back by the
  // server, labels joined at runtime) get the full stop literals carry already.
  async function Notify(Message: unknown, Type = 'info', Duration = 5000): Promise<void> {
    showAlertStyleToast({
      title: WithFullStop(Message),
      message: '',
      type: Type,
      duration: Duration,
      linkAlert: false,
    });
  }

  return { iconForType, showAlertStyleToast, Notify };
}
