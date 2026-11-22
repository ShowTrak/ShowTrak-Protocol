// @showtrak/protocol/ui/html: the single HTML escaper for the renderers of
// ShowTrak Server and ShowTrak Timers (each app's utils.ts re-exports it).
//
// One copy on purpose: an escaper that drifts between apps is a security bug in
// one of them. Timers 1.x escaped only < and >, so a timer name or setting
// value containing a quote broke out of the attribute it was rendered into.

/**
 * Escape all five significant entities (ampersand first), so the result is safe
 * in text content AND in double- or single-quoted attribute values. Always
 * returns a string: null/undefined collapse to '' (never the literal
 * "null"/"undefined"), and arrays are escaped element-wise and comma-joined to
 * match how an array would otherwise stringify inside a template literal.
 */
export function Safe(Input: unknown): string {
  if (typeof Input === 'string') {
    return Input.replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
  if (Array.isArray(Input)) {
    return (Input as readonly unknown[]).map(Safe).join(',');
  }
  if (Input === null || Input === undefined) {
    return '';
  }
  // Numbers, booleans, and any object/function are coerced to their string form
  // and then escaped, so nothing can carry markup through an interpolation.
  return Safe(String(Input));
}
