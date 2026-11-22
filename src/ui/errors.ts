// @showtrak/protocol/ui/errors: the renderer's error helpers, the same in
// ShowTrak Server and ShowTrak Timers (each app's utils.ts re-exports them).

/**
 * A human-readable message from an unknown thrown value (catch clauses are
 * typed `unknown`): its non-empty `message`, else the caller's fallback, else
 * the value as a string.
 */
export function ErrorMessage(Err: unknown, Fallback = ''): string {
  if (Err && typeof Err === 'object' && 'message' in Err) {
    const Message = (Err as { message?: unknown }).message;
    if (typeof Message === 'string' && Message.length > 0) return Message;
  }
  if (Fallback) return Fallback;
  return String(Err);
}

/**
 * Report an error the renderer carries on from: a console warning labelled
 * `[NonFatal] <Context>`, with the error when there is one. It is the
 * last-resort reporter, so it never throws.
 */
export function HandleNonFatalError(Context: unknown, Error: unknown = null): void {
  try {
    const Label = Context ? `[NonFatal] ${Context}` : '[NonFatal]';
    if (Error) {
      console.warn(Label, Error);
      return;
    }
    console.warn(Label);
  } catch {
    /* intentional: this is the last-resort error reporter; it must never throw */
  }
}
