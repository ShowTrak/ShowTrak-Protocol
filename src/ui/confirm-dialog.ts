// @showtrak/protocol/ui/confirm-dialog: the confirmation dialog of ShowTrak
// Server and ShowTrak Timers. One promise-based, keyboard-driven question at a
// time, with Cancel and a named confirm button (and, optionally, a third choice
// between them).
//
// The one thing each app adds is what happens while a question is open
// (`OnActiveChange`): both record it in their state, so their keyboard
// shortcuts stand down; Server also redraws its identify banner. Each app calls
// CreateConfirmationDialog once, in its own toasts module, and re-exports the
// result with CancelConfirmation.
//
// The fixes either app made to its copy are all here: keys only answer the
// dialog when the focus is on its buttons (never a key held down from before it
// opened), it sits inside an open modal and closing that modal cancels it,
// opening a second one cancels the first, and Escape with the right-click menu
// (#SHOWTRAK_CONTEXT_MENU) open closes just the menu.
import { HandleNonFatalError } from './errors';
import { Safe } from './html';

/** Options accepted by ConfirmationDialog. */
export interface ConfirmationDialogOptions {
  /**
   * The confirm button's label, naming the action in Title Case ("Delete Tag",
   * "Run Script"). Required so no dialog falls back to a vague "Confirm".
   */
  ConfirmLabel: string;
  /**
   * A second, non-destructive choice between Cancel and Confirm ("Don't
   * Save"). Chosen, the dialog resolves to 'alt' rather than true or false.
   */
  AltLabel?: string;
}

/** true (Confirm), false (Cancel, Escape, or the question went away) or 'alt'. */
export type ConfirmationAnswer = boolean | 'alt';

/** What an app does around every question (see CreateConfirmationDialog). */
export interface ConfirmationDialogHooks {
  /**
   * Called with true as a question opens and false as it closes, before the
   * focus goes back to where it was.
   */
  OnActiveChange?: (Active: boolean) => void;
}

/**
 * Ask a question with Cancel and a named confirm button (and optionally a
 * third choice). Resolves true or false, or 'alt' when `AltLabel` is given and
 * chosen.
 *
 * Keys go to the dialog's own buttons, as to any button: Enter or Space on the
 * focused one (Confirm, to start with), Tab and the arrow keys to move between
 * them, Escape to cancel. A key pressed anywhere else (typing in a field behind
 * the dialog) never answers it, and neither does a key held down from before
 * it opened. Inside an open modal the dialog is placed in that modal, which is
 * where Bootstrap keeps the focus, and closing the modal cancels it. Opening a
 * second dialog cancels the first.
 */
export interface ConfirmationDialog {
  (
    Message: unknown,
    Options: ConfirmationDialogOptions & { AltLabel?: undefined }
  ): Promise<boolean>;
  (Message: unknown, Options: ConfirmationDialogOptions): Promise<ConfirmationAnswer>;
}

// The confirmation waiting for an answer, if any: only one at a time, whichever
// app module asked it.
let ActiveConfirmation: { Finish: (Answer: ConfirmationAnswer) => void } | null = null;

/**
 * Close a confirmation that is waiting, as if Cancel was chosen. Called when
 * whatever it was asked about goes away (its modal closes, another show is
 * opened, every modal is closed for something else), so a stale question can
 * never be answered.
 */
export function CancelConfirmation(): void {
  ActiveConfirmation?.Finish(false);
}

/** The dialog's markup. The third button is only there with `AltLabel`. */
export function ConfirmationDialogHtml(
  Message: unknown,
  Options: ConfirmationDialogOptions
): string {
  const AltButton = Options.AltLabel
    ? `
						<button type="button" class="btn btn-sm btn-secondary" id="CONFIRM_TOAST_ALT">${Safe(Options.AltLabel)}</button>`
    : '';
  return `
			<div id="SHOWTRAK_CONFIRM_TOAST" role="alertdialog" aria-modal="true" aria-labelledby="CONFIRM_TOAST_MESSAGE" class="confirm-toast no-drag">
				<div class="confirm-toast-body">
					<div class="confirm-toast-msg" id="CONFIRM_TOAST_MESSAGE">${Safe(Message)}</div>
					<div class="confirm-toast-actions">
						<button type="button" class="btn btn-sm btn-secondary" id="CONFIRM_TOAST_CANCEL">Cancel</button>${AltButton}
						<button type="button" class="btn btn-sm btn-danger" id="CONFIRM_TOAST_CONFIRM">${Safe(Options.ConfirmLabel)}</button>
					</div>
				</div>
			</div>`;
}

/**
 * The app's ConfirmationDialog, with its hooks. Server passes
 * `{ OnActiveChange: (Active) => { setConfirmDialogActive(Active); UpdateIdentifyStatusBanner(); } }`,
 * Timers `{ OnActiveChange: setConfirmDialogActive }`. Touches nothing until a
 * question is asked.
 */
export function CreateConfirmationDialog(Hooks: ConfirmationDialogHooks = {}): ConfirmationDialog {
  const SetActive = (Active: boolean) => {
    if (Hooks.OnActiveChange) Hooks.OnActiveChange(Active);
  };

  function Ask(
    Message: unknown,
    Options: ConfirmationDialogOptions & { AltLabel?: undefined }
  ): Promise<boolean>;
  function Ask(Message: unknown, Options: ConfirmationDialogOptions): Promise<ConfirmationAnswer>;
  async function Ask(
    Message: unknown,
    Options: ConfirmationDialogOptions
  ): Promise<ConfirmationAnswer> {
    CancelConfirmation();
    return new Promise<ConfirmationAnswer>((resolve) => {
      const existing = document.getElementById('SHOWTRAK_CONFIRM_TOAST');
      if (existing) {
        try {
          existing.remove();
        } catch (err) {
          HandleNonFatalError('Toasts:NonFatal', err);
        }
      }

      // In the open modal, if there is one: Bootstrap pulls the focus back into
      // an open modal, so a dialog outside it could never hold the focus.
      const HostModal = document.querySelector<HTMLElement>('.modal.show');
      $(HostModal ?? document.body).append(ConfirmationDialogHtml(Message, Options));
      const $toast = $('#SHOWTRAK_CONFIRM_TOAST');
      const $btnCancel = $('#CONFIRM_TOAST_CANCEL');
      const $btnConfirm = $('#CONFIRM_TOAST_CONFIRM');
      const $btnAlt = $('#CONFIRM_TOAST_ALT');
      const Buttons = () => $toast.find('button').toArray() as HTMLElement[];
      const Previous = document.activeElement as HTMLElement | null;

      SetActive(true);

      let Done = false;
      const OnEscape = (e: KeyboardEvent) => {
        if (e.key !== 'Escape') return;
        // An open context menu takes its own Escape.
        const $ctx = $('#SHOWTRAK_CONTEXT_MENU');
        if ($ctx.length && $ctx.is(':visible')) return;
        // Before the modal behind sees it: Escape cancels the question, not the modal.
        e.preventDefault();
        e.stopPropagation();
        Finish(false);
      };
      const Finish = (Answer: ConfirmationAnswer) => {
        if (Done) return;
        Done = true;
        ActiveConfirmation = null;
        document.removeEventListener('keydown', OnEscape, true);
        if (HostModal) $(HostModal).off('hide.bs.modal.confirmToast');
        try {
          $toast.remove();
        } catch (err) {
          HandleNonFatalError('Toasts:NonFatal', err);
        }
        SetActive(false);
        // Back to where the focus was, if that is still on the page.
        if (Previous && Previous.isConnected) {
          try {
            Previous.focus();
          } catch {
            /* intentional: best-effort */
          }
        }
        resolve(Answer);
      };
      ActiveConfirmation = { Finish };

      $btnCancel.on('click', () => Finish(false));
      $btnConfirm.on('click', () => Finish(true));
      $btnAlt.on('click', () => Finish('alt'));

      document.addEventListener('keydown', OnEscape, true);
      if (HostModal) $(HostModal).one('hide.bs.modal.confirmToast', () => Finish(false));

      $toast.on('keydown', (e) => {
        const Native = e.originalEvent as KeyboardEvent | undefined;
        // A key held down (from the button that opened the dialog) repeats into
        // it: never let a repeat answer it.
        if ((e.key === 'Enter' || e.key === ' ') && Native?.repeat) {
          e.preventDefault();
          return;
        }
        const List = Buttons();
        const Index = List.indexOf(document.activeElement as HTMLElement);
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          const Step = e.key === 'ArrowLeft' ? -1 : 1;
          const Next = Index === -1 ? List.length - 1 : (Index + Step + List.length) % List.length;
          List[Next]?.focus();
          return;
        }
        // Tab stays among the dialog's buttons while it is open.
        if (e.key === 'Tab') {
          e.preventDefault();
          const Step = e.shiftKey ? -1 : 1;
          const Next = Index === -1 ? 0 : (Index + Step + List.length) % List.length;
          List[Next]?.focus();
        }
      });

      // Confirm starts with the focus, so Enter (on it) confirms.
      setTimeout(() => {
        try {
          if (!Done) $btnConfirm.trigger('focus');
        } catch (err) {
          HandleNonFatalError('Toasts:NonFatal', err);
        }
      }, 0);
    });
  }

  return Ask;
}
