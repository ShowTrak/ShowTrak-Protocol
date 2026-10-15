// Client vitals telemetry, emitted on every heartbeat.
// Source of truth: ShowTrakClient `OS.GetVitals()`.

export interface CpuVitals {
  /** Smoothed CPU usage percentage (0-100). */
  UsagePercentage: number;
}

export interface RamVitals {
  /** Total physical memory in bytes. */
  Total: number;
  /**
   * Used physical memory in bytes. On macOS this is what Activity Monitor
   * calls "Memory Used" (app + wired + compressed): the kernel's free count
   * excludes reclaimable cache, so `total - free` read close to 100% on any
   * Mac that had been up for a while. Clients before 3.22.0 sent that figure.
   */
  Used: number;
  /**
   * Used-memory percentage formatted to two decimals.
   * NOTE: this is transmitted as a STRING (produced via `Number#toFixed(2)`).
   */
  UsagePercentage: string;
}

export interface UptimeVitals {
  /** Operating-system uptime formatted as `HH:mm:ss`; hours are unbounded. */
  Formatted: string;
  /**
   * Operating-system uptime in whole seconds. Added in ShowTrak Client 3.22.0;
   * an older client omits it, and readers fall back to parsing `Formatted`.
   */
  Seconds?: number;
}

export interface Vitals {
  CPU: CpuVitals;
  Ram: RamVitals;
  Uptime: UptimeVitals;
}
