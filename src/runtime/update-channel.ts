// Update channels: which GitHub release an app (or a client deployment) should
// move to.
//
//   - stable: the newest full release. Pre-releases are never offered.
//   - beta:   the newest release of any kind. That is usually a pre-release,
//             but a stable release published after the last beta wins too, so
//             a beta tester is never left behind on an old beta.
//
// "Newest" is the highest version number, not the most recent date. A hotfix
// for the previous line (3.31.2 published after 3.32.0-beta.1) would otherwise
// count as newest and could never be installed anyway, since the updaters do
// not downgrade.
//
// Shared by ShowTrakServer and ShowTrakClient: both apps' self-updaters and the
// server's LAN client deployment use the same rule. Pure apart from
// ResolveChannelRelease, which takes its fetch function as an argument.

export type UpdateChannel = 'stable' | 'beta';

/** Anything that is not clearly "beta" is stable: the safe default. */
export function NormalizeUpdateChannel(Value: unknown): UpdateChannel {
  return String(Value || '')
    .trim()
    .toLowerCase() === 'beta'
    ? 'beta'
    : 'stable';
}

interface ParsedVersion {
  Core: [number, number, number];
  Pre: string[];
}

/** Parse "v3.32.0-beta.1" / "3.32.0" (a leading "v" is allowed). Null if not a version. */
export function ParseVersion(Value: unknown): ParsedVersion | null {
  const Match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    String(Value || '').trim()
  );
  if (!Match) return null;
  return {
    Core: [Number(Match[1]), Number(Match[2]), Number(Match[3])],
    Pre: Match[4] ? Match[4].split('.') : [],
  };
}

/** True for versions with a pre-release part ("3.32.0-beta.1"). */
export function IsPrereleaseVersion(Value: unknown): boolean {
  const Parsed = ParseVersion(Value);
  return !!Parsed && Parsed.Pre.length > 0;
}

/**
 * Semantic-version ordering: negative when A < B, positive when A > B, 0 when
 * equal. A release outranks its own pre-releases (3.32.0 > 3.32.0-beta.9);
 * pre-release identifiers compare numerically when both are numbers
 * (beta.10 > beta.9). Unparseable values sort lowest.
 */
export function CompareVersions(A: unknown, B: unknown): number {
  const PA = ParseVersion(A);
  const PB = ParseVersion(B);
  if (!PA || !PB) return (PA ? 1 : 0) - (PB ? 1 : 0);
  for (let i = 0; i < 3; i++) {
    const X = PA.Core[i] ?? 0;
    const Y = PB.Core[i] ?? 0;
    if (X !== Y) return X - Y;
  }
  if (!PA.Pre.length || !PB.Pre.length) return PB.Pre.length - PA.Pre.length;
  for (let i = 0; i < Math.max(PA.Pre.length, PB.Pre.length); i++) {
    const X = PA.Pre[i];
    const Y = PB.Pre[i];
    if (X === undefined) return -1;
    if (Y === undefined) return 1;
    const XN = /^\d+$/.test(X);
    const YN = /^\d+$/.test(Y);
    if (XN && YN) {
      if (Number(X) !== Number(Y)) return Number(X) - Number(Y);
    } else if (XN !== YN) {
      return XN ? -1 : 1;
    } else if (X !== Y) {
      return X < Y ? -1 : 1;
    }
  }
  return 0;
}

/** The fields of a GitHub release these rules read. */
export interface ChannelRelease {
  tag_name?: string | null;
  draft?: boolean;
  prerelease?: boolean;
}

/** Whether a release counts as a pre-release: GitHub's flag or a pre-release version. */
export function IsPrereleaseRelease(Release: ChannelRelease | null | undefined): boolean {
  return !!Release && (Release.prerelease === true || IsPrereleaseVersion(Release.tag_name));
}

/** Whether a channel may install (or deploy) this release at all. */
export function ChannelAllowsRelease(
  Channel: UpdateChannel,
  Release: ChannelRelease | null | undefined
): boolean {
  if (!Release || Release.draft || !ParseVersion(Release.tag_name)) return false;
  return Channel === 'beta' || !IsPrereleaseRelease(Release);
}

/** The release a channel should move to: the highest version it allows. */
export function PickChannelRelease<T extends ChannelRelease>(
  Releases: ReadonlyArray<T> | null | undefined,
  Channel: UpdateChannel
): T | null {
  let Best: T | null = null;
  for (const Release of Array.isArray(Releases) ? Releases : []) {
    if (!ChannelAllowsRelease(Channel, Release)) continue;
    if (!Best || CompareVersions(Release.tag_name, Best.tag_name) > 0) Best = Release;
  }
  return Best;
}

/** Where a release's update files (RELEASES, latest-mac.yml ...) are served from. */
export function ReleaseDownloadBase(Owner: string, Repo: string, Tag: string): string {
  return `https://github.com/${Owner}/${Repo}/releases/download/${encodeURIComponent(Tag)}/`;
}

/**
 * Find the release the beta channel should install, from the GitHub releases
 * API. Returns its tag and update feed URL, or null when the list could not be
 * read or has nothing installable (the caller falls back to the stable feed).
 */
export async function ResolveChannelRelease(Options: {
  Owner: string;
  Repo: string;
  Channel: UpdateChannel;
  FetchJson: (Url: string) => Promise<unknown>;
}): Promise<{ Tag: string; FeedURL: string; Prerelease: boolean } | null> {
  const Url = `https://api.github.com/repos/${Options.Owner}/${Options.Repo}/releases?per_page=30`;
  const List = await Options.FetchJson(Url);
  const Release = PickChannelRelease(
    Array.isArray(List) ? (List as ChannelRelease[]) : [],
    Options.Channel
  );
  if (!Release || !Release.tag_name) return null;
  return {
    Tag: Release.tag_name,
    FeedURL: ReleaseDownloadBase(Options.Owner, Options.Repo, Release.tag_name),
    Prerelease: IsPrereleaseRelease(Release),
  };
}
