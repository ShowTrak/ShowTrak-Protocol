// ShowTrak Timers: groups as the renderer sees them. Modelled on ShowTrak
// Server's groups (a title, an OSC slug, a tint, a width on the group column
// grid, a selection keybind), but a separate shape: the Server's GroupView in
// the package root is not this one.
//
// Timers in no group are in the Default group, which always exists, sits last,
// and cannot be edited, renamed or deleted; it is never sent as a GroupView.
// The constants and rules that go with these (GROUP_COLOURS, Slugify ...) stay
// in the Timers repo (src/common/groups.ts).

export interface GroupView {
  GroupID: number;
  Title: string;
  /** The group's OSC address segment: /ShowTrak/Group/<Slug>/Start. Unique, any case. */
  Slug: string;
  Weight: number;
  /** Full width spans every column of the group grid; otherwise ColumnSpan columns. */
  isFullWidth: boolean;
  ColumnSpan: number;
  /** Index into the shared eight-colour palette, or null for an untinted box. */
  Colour: number | null;
  /** KeyboardEvent.code of the key that toggles the group's selection, or null. */
  KeyBind: string | null;
}

/** Fields a group create or update may carry (all optional). */
export interface GroupPatchView {
  Title?: string;
  Slug?: string;
  /** 'full', or a number of columns. */
  Width?: 'full' | number;
  Colour?: number | null;
  KeyBind?: string | null;
}
