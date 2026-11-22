// @showtrak/protocol/ui/icons: which variant of a Bootstrap Icons glyph an app
// draws its status icons in. ShowTrak Server uses the outline glyphs
// (bi-check-circle); ShowTrak Timers, restyled for 2.0, the filled ones
// (bi-check-circle-fill). The kit's toasts and Software Update modal take the
// app's style, so each app keeps its look.

/** An app's status-icon style: Server 'outline', Timers 'fill'. */
export type IconStyle = 'outline' | 'fill';

/**
 * The class of a glyph in the given style. `Glyph` is the outline name
 * ('bi-check-circle'); it must be one Bootstrap Icons also has as `-fill`.
 */
export function StyledGlyph(Glyph: string, Style: IconStyle): string {
  return Style === 'fill' ? `${Glyph}-fill` : Glyph;
}
