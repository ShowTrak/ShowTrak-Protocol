// Lenient version ordering, for version strings that are not strict semver.
//
// @showtrak/protocol/runtime's CompareVersions is strict: it orders release
// tags ("v3.32.0-beta.1") and treats anything it cannot parse as lowest. Two
// kinds of version the apps compare are not tags:
//   - Squirrel.Windows rewrites a pre-release, "2.0.0-beta.1" becoming
//     "2.0.0-beta1" in its package names, and NuGet versions may have a
//     fourth part;
//   - the version stamped into a saved show file, which predates any check.
//
// ShowTrak Server ordered these by splitting on "." and "-" and reading each
// part as a number, so every pre-release ranked level with its release
// ("beta1" reads as 0) and the newest package in a RELEASES manifest could be a
// beta that the final release had replaced. ShowTrak Timers fixed that; this is
// its fix, shared.

function SplitVersion(Version: string): { Core: number[]; Pre: string[] } {
  const Text = String(Version || '')
    .trim()
    .replace(/^v/i, '');
  const Dash = Text.indexOf('-');
  const Core = (Dash === -1 ? Text : Text.slice(0, Dash))
    .split('.')
    .map((N) => parseInt(N, 10) || 0);
  const Pre = Dash === -1 ? [] : (Text.slice(Dash + 1).match(/\d+|[A-Za-z]+/g) ?? []);
  return { Core, Pre };
}

/**
 * Order two version strings: negative when A is older than B, positive when
 * newer, 0 when equal.
 *
 * The numeric parts of the version core compare first, any number of them
 * ("3.10.0" after "3.9.0", a missing part reading as 0). Then a release
 * outranks its own pre-releases, and pre-release parts compare number to number
 * ("beta2" after "beta1", "beta10" after "beta9") or text to text, a number
 * ranking below text. Both "2.0.0-beta.1" and "2.0.0-beta1" read as
 * beta, 1, so the two spellings order the same. A leading "v" is ignored.
 */
export function CompareLooseVersions(A: string, B: string): number {
  const PA = SplitVersion(A);
  const PB = SplitVersion(B);
  for (let I = 0; I < Math.max(PA.Core.length, PB.Core.length); I++) {
    const Diff = (PA.Core[I] ?? 0) - (PB.Core[I] ?? 0);
    if (Diff !== 0) return Diff;
  }
  if (!PA.Pre.length || !PB.Pre.length) return PB.Pre.length - PA.Pre.length;
  for (let I = 0; I < Math.max(PA.Pre.length, PB.Pre.length); I++) {
    const X = PA.Pre[I];
    const Y = PB.Pre[I];
    if (X === undefined) return -1;
    if (Y === undefined) return 1;
    const XNum = /^\d+$/.test(X);
    const YNum = /^\d+$/.test(Y);
    if (XNum && YNum) {
      if (Number(X) !== Number(Y)) return Number(X) - Number(Y);
    } else if (XNum !== YNum) {
      return XNum ? -1 : 1;
    } else if (X !== Y) {
      return X < Y ? -1 : 1;
    }
  }
  return 0;
}
