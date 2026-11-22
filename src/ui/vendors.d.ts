// Ambient declarations for the vendored libraries ShowTrak Server's and
// ShowTrak Timers' renderers load as page globals: Bootstrap (and its jQuery
// plugin bridge) and Howler. Both apps load them with <script> tags (offline,
// never bundled or imported) and reference them as globals. jQuery itself ($)
// is typed by @types/jquery, which each program lists in `types`.
//
// This replaces the copy of these declarations each app kept in its own
// src/UI/types/vendors.d.ts; an app's file keeps only what is its own (window
// globals, the Web Dashboard's socket). An app's renderer programs include this
// file by path ("shared/src/ui/vendors.d.ts"); the kit's own build includes it
// too, for the `.modal()` calls in ./app-updates. Do not declare any of these
// again in an app, or the two `declare const`s clash.
//
// The interfaces are intentionally *minimal*: they cover only the surface the
// renderers actually touch, not the vendors' full public API.

// ---- Howler (audio) -------------------------------------------------------

interface HowlOptions {
  src: string[];
  volume?: number;
  loop?: boolean;
  preload?: boolean;
  html5?: boolean;
  onloaderror?: () => void;
  onplayerror?: () => void;
}

interface Howl {
  play(): number;
  stop(): this;
  pause(): this;
  load(): this;
  state(): 'unloaded' | 'loading' | 'loaded';
  playing(): boolean;
  unload(): void;
  once(event: 'end' | 'stop' | 'loaderror' | 'playerror', callback: () => void): this;
  volume(value?: number): number | this;
  fade(from: number, to: number, duration: number): this;
}

interface HowlConstructor {
  new (options: HowlOptions): Howl;
}

declare const Howl: HowlConstructor;
declare const Howler: { volume(value?: number): number; mute(muted: boolean): void };

// ---- Bootstrap ------------------------------------------------------------

interface BootstrapComponent {
  show(): void;
  hide(): void;
  toggle(): void;
  dispose(): void;
}

interface BootstrapComponentConstructor {
  new (element: Element | null, options?: Record<string, unknown>): BootstrapComponent;
  getInstance(element: Element | null): BootstrapComponent | null;
  getOrCreateInstance(
    element: Element | null,
    options?: Record<string, unknown>
  ): BootstrapComponent;
}

declare const bootstrap: {
  Modal: BootstrapComponentConstructor;
  Collapse: BootstrapComponentConstructor;
  Popover: BootstrapComponentConstructor;
  Tooltip: BootstrapComponentConstructor;
  Tab: BootstrapComponentConstructor;
};

// Bootstrap's jQuery plugin bridge (not covered by @types/jquery).
interface JQuery<TElement = HTMLElement> {
  modal(action?: unknown): JQuery<TElement>;
  popover(action?: unknown): JQuery<TElement>;
  collapse(action?: unknown): JQuery<TElement>;
  tooltip(action?: unknown): JQuery<TElement>;
  tab(action?: unknown): JQuery<TElement>;
}
