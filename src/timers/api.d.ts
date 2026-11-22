// ShowTrak Timers: the contract between its main process and its desktop
// renderer. The IPC channels (what each takes and answers, what each push
// carries), and `window.API` as the preload bridges expose it.
//
// The channel lists themselves are runtime values and stay in the Timers repo
// (INVOKE_CHANNELS / PUSH_CHANNELS in src/common/api.ts, and the copies the
// sandboxed preload inlines). Check each against the unions here, both ways:
//
//   type _InvokeComplete = AssertTrue<ChannelListCheck<InvokeChannel, typeof INVOKE_CHANNELS>>;
//   type _PushComplete = AssertTrue<ChannelListCheck<PushChannel, typeof PUSH_CHANNELS>>;

import type {
  AppMode,
  AppUpdateStatus,
  ResultTuple,
  Setting,
  SettingGroup,
  SettingType as AnySettingType,
  SettingValue,
  ShowFileOpenOutcome,
  ShowFileRequest,
  ShowFileUpgrade,
  Unsubscribe,
} from '../app';
import type { GroupPatchView, GroupView } from './groups';
import type { ClockFormat, EndBehaviour, TimerType, TimerView } from './timers';

// ---- View models ------------------------------------------------------------

/** What `GetConfig` answers (the main window and the splash window both ask). */
export interface AppConfigView {
  Application: { Name: string; Version: string };
  /** Node's `process.platform`. */
  Platform: string;
  IsPackaged: boolean;
}

/** A run control, for one timer or many. */
export type ControlAction = 'Start' | 'Stop' | 'Pause' | 'Unpause';

/** The external pages the app can open in the default browser. */
export type ExternalLink = 'discord' | 'website' | 'github';

/**
 * The setting types ShowTrak Timers uses. It has no PASSWORD settings: its one
 * secret, the Web Dashboard passcode, is a STRING setting.
 */
export type SettingType = Exclude<AnySettingType, 'PASSWORD'>;

/** A setting as the renderer receives it (`GetSettings`, `Settings:Updated`). */
export interface SettingView extends Setting<SettingType> {
  /**
   * Edited with an explicit Save button rather than applied as typed: network
   * settings, where every keystroke would otherwise rebind a socket.
   */
  RequiresSave: boolean;
}

/** A settings group as the renderer receives it. Timers groups have no ShowWhen or Parent. */
export type SettingGroupView = Pick<SettingGroup, 'Name' | 'Title'>;

/** Fields a timer create or update may carry (all optional). */
export interface TimerPatchView {
  Type?: TimerType;
  Name?: string;
  Description?: string;
  Duration?: number | null;
  ShowOnWeb?: boolean;
  EndBehaviour?: EndBehaviour;
  CompletionSound?: string | null;
  CompletionToast?: boolean;
  WarningMs?: number | null;
  WarningSound?: string | null;
  WarningToast?: boolean;
  ShowHundredths?: boolean;
  ClockFormat?: ClockFormat;
  /** A group ID, or null for the Default group. */
  GroupID?: number | null;
}

/** What the title bar shows about the open show file. */
export interface ShowFileStateView {
  FilePath: string | null;
  Unsaved: boolean;
  /** Goes up each time another show is loaded (open, new, a declined upgrade). */
  Generation: number;
}

/**
 * An upgrade the operator accepted (Show:ResolveUpgrade): the original was
 * copied to BackupPath, then the file was upgraded (or, when it is the show
 * already open, is upgraded by its next save).
 */
export interface ShowFileUpgradeAcceptedView {
  FilePath: string;
  BackupPath: string;
}

/**
 * An upgrade the operator declined (Show:ResolveUpgrade). The file is left
 * untouched. Cleared: the working show was cleared, as it is when the declined
 * file was the show left open last session (the renderer then starts a new
 * show file); otherwise the show already open stays open.
 */
export interface ShowFileUpgradeDeclinedView {
  Cleared: boolean;
}

/** Where one timer sits after a drag: its group (null for the Default group). */
export interface TimerPlacementView {
  ID: number;
  GroupID: number | null;
}

/** A timer reached its warning window or its end: what to play and whether to toast. */
export interface TimerEventView {
  Kind: 'warning' | 'complete';
  TimerID: number;
  Name: string;
  /** A sound reference ("builtin:<name>" or "asset:<id>"), or null for none. */
  Sound: string | null;
  Toast: boolean;
}

/** A sound in the Sound Library. */
export interface LibrarySoundView {
  ID: string;
  Label: string;
  OriginalName: string;
  Extension: string;
  /** A percentage, 0-200 (the Sound Library's slider sets up to 100). */
  Volume: number;
  /** Bytes. */
  Size: number;
  Timestamp: number;
  /** The file is gone from the library folder. */
  Missing: boolean;
}

/** Fields a sound update may carry. */
export interface SoundPatchView {
  Label?: string;
  Volume?: number;
}

/** A sound's audio, ready to play. */
export interface SoundDataView {
  ID: string;
  Label: string;
  Volume: number;
  DataURL: string;
}

export interface ServiceStatus {
  Enabled: boolean;
  Running: boolean;
  Host: string | null;
  Port: number | null;
}

/** The OSC listener and the Web Dashboard, as the status bar shows them. */
export interface ServicesStatusView {
  OSC: ServiceStatus;
  WebDashboard: ServiceStatus & {
    /** http:// addresses the dashboard can be opened at from another device. */
    URLs: string[];
    /** Browsers signed in and watching. */
    Clients: number;
  };
}

/** One entry of the OSC reference. */
export interface OscRouteView {
  Path: string;
  Title: string;
}

/** One entry of the About modal's dependency list. */
export interface DependencyView {
  name: string;
  version: string;
}

// ---- Channels ---------------------------------------------------------------

/** Every invoke channel: what the renderer sends with it, and what the main process answers. */
export interface InvokeMap {
  'Config:Get': { Args: []; Result: AppConfigView };
  Loaded: { Args: []; Result: void };
  'Settings:Get': { Args: []; Result: SettingView[] };
  'Settings:Set': { Args: [Key: string, Value: SettingValue]; Result: ResultTuple<SettingView> };
  'Mode:Get': { Args: []; Result: AppMode };
  'Mode:Set': { Args: [Mode: AppMode]; Result: AppMode };
  'Timers:List': { Args: []; Result: TimerView[] };
  'Timer:Get': { Args: [ID: number]; Result: ResultTuple<TimerView> };
  'Timer:Create': { Args: [Patch: TimerPatchView]; Result: ResultTuple<TimerView> };
  'Timer:Update': { Args: [ID: number, Patch: TimerPatchView]; Result: ResultTuple<TimerView> };
  'Timer:Delete': { Args: [ID: number]; Result: ResultTuple<true> };
  'Timer:Control': { Args: [ID: number, Action: ControlAction]; Result: ResultTuple<TimerView> };
  'Timer:JumpTo': { Args: [ID: number, Ms: number]; Result: ResultTuple<TimerView> };
  'Timers:ControlAll': { Args: [Action: ControlAction]; Result: ResultTuple<number> };
  'Timers:ControlMany': {
    Args: [IDs: number[], Action: ControlAction];
    Result: ResultTuple<number>;
  };
  'Timers:DeleteMany': { Args: [IDs: number[]]; Result: ResultTuple<number> };
  'Timers:MoveToGroup': {
    Args: [IDs: number[], GroupID: number | null];
    Result: ResultTuple<number>;
  };
  'Timers:Arrange': { Args: [Layout: TimerPlacementView[]]; Result: ResultTuple<true> };
  'Groups:List': { Args: []; Result: GroupView[] };
  'Group:Create': { Args: [Patch: GroupPatchView]; Result: ResultTuple<GroupView> };
  'Group:Update': { Args: [ID: number, Patch: GroupPatchView]; Result: ResultTuple<GroupView> };
  'Group:Delete': { Args: [ID: number]; Result: ResultTuple<true> };
  'Groups:Reorder': { Args: [IDs: number[]]; Result: ResultTuple<true> };
  'Show:GetCurrentFile': { Args: []; Result: string | null };
  'Show:New': { Args: []; Result: ResultTuple<string> };
  'Show:Open': { Args: []; Result: ResultTuple<ShowFileOpenOutcome> };
  'Show:Save': { Args: []; Result: ResultTuple<string> };
  'Show:SaveAs': { Args: []; Result: ResultTuple<string> };
  'Show:CheckUpgrade': { Args: []; Result: ResultTuple<ShowFileUpgrade | null> };
  'Show:ResolveUpgrade': {
    Args: [Accept: boolean];
    Result: ResultTuple<ShowFileUpgradeAcceptedView | ShowFileUpgradeDeclinedView>;
  };
  'Show:HasUnsavedData': { Args: []; Result: boolean };
  'Show:EnsureFileExists': {
    Args: [];
    Result: ResultTuple<{ Missing: boolean; FilePath?: string }>;
  };
  /** The show file the operating system asked to open, if one is waiting. */
  'Show:TakeOpenRequest': { Args: []; Result: ResultTuple<ShowFileRequest | null> };
  /** Open the file Show:TakeOpenRequest returned, once the operator has agreed. */
  'Show:OpenRequested': { Args: []; Result: ResultTuple<ShowFileOpenOutcome> };
  'App:OpenBackupsFolder': { Args: []; Result: void };
  'Sounds:List': { Args: []; Result: LibrarySoundView[] };
  'Sounds:Import': { Args: []; Result: ResultTuple<LibrarySoundView> };
  'Sounds:Update': {
    Args: [ID: string, Patch: SoundPatchView];
    Result: ResultTuple<LibrarySoundView>;
  };
  'Sounds:Delete': { Args: [ID: string]; Result: ResultTuple<true> };
  'Sounds:GetData': { Args: [ID: string]; Result: ResultTuple<SoundDataView> };
  'Services:GetStatus': { Args: []; Result: ServicesStatusView };
  'OSC:GetRoutes': { Args: []; Result: OscRouteView[] };
  'App:OpenLogsFolder': { Args: []; Result: void };
  'App:OpenExternal': { Args: [Link: ExternalLink]; Result: void };
  'App:GetDependencies': { Args: []; Result: ResultTuple<{ dependencies: DependencyView[] }> };
  'App:GetLicense': { Args: []; Result: ResultTuple<{ license: string }> };
  'AppUpdate:Check': { Args: []; Result: void };
  'AppUpdate:Install': { Args: []; Result: void };
  /**
   * Confirmed: the renderer has already asked the operator to confirm the quit
   * (Stop Accidental Shutdowns), so the main process quits without asking again.
   */
  Shutdown: { Args: [Confirmed?: boolean]; Result: void };
}

/** The invoke allowlist (INVOKE_CHANNELS). */
export type InvokeChannel = keyof InvokeMap;

/** What the main process pushes to the renderer, channel by channel (arguments in order). */
export interface PushMap {
  'Timers:Updated': [Timers: TimerView[]];
  'Timer:Event': [Event: TimerEventView];
  'Groups:Updated': [Groups: GroupView[]];
  'ShowFile:Updated': [State: ShowFileStateView];
  /** A show file was opened from the operating system: take it with Show:TakeOpenRequest. */
  'ShowFile:OpenRequested': [];
  'Settings:Updated': [Settings: SettingView[], Groups: SettingGroupView[]];
  'Mode:Updated': [Mode: AppMode];
  /** Duration in ms, or null for the renderer's default. */
  Notify: [Message: string, Type: string, Duration: number | null];
  'Sounds:Updated': [Sounds: LibrarySoundView[]];
  'Services:Status': [Status: ServicesStatusView];
  'WebDashboard:ClientCount': [Count: number];
  'AppUpdate:Status': [Status: AppUpdateStatus];
  AppMenuAction: [Action: string];
  ShutdownRequested: [];
  /** The main window entered or left native full screen (and once on load). */
  MainWindowFullscreenChanged: [IsFullscreen: boolean];
}

/** The push allowlist (PUSH_CHANNELS). */
export type PushChannel = keyof PushMap;

// ---- Bridges ----------------------------------------------------------------

/** `window.API` in the desktop renderer, exposed by src/bridge_main.ts. */
export interface TimersAPI {
  GetConfig(): Promise<AppConfigView>;
  Loaded(): Promise<void>;

  GetSettings(): Promise<SettingView[]>;
  SetSetting(Key: string, Value: SettingValue): Promise<ResultTuple<SettingView>>;
  OnSettings(Callback: (Settings: SettingView[], Groups: SettingGroupView[]) => void): Unsubscribe;

  GetMode(): Promise<AppMode>;
  SetMode(Mode: AppMode): Promise<AppMode>;
  OnMode(Callback: (Mode: AppMode) => void): Unsubscribe;

  ListTimers(): Promise<TimerView[]>;
  GetTimer(ID: number): Promise<ResultTuple<TimerView>>;
  CreateTimer(Patch: TimerPatchView): Promise<ResultTuple<TimerView>>;
  UpdateTimer(ID: number, Patch: TimerPatchView): Promise<ResultTuple<TimerView>>;
  DeleteTimer(ID: number): Promise<ResultTuple<true>>;
  ControlTimer(ID: number, Action: ControlAction): Promise<ResultTuple<TimerView>>;
  JumpTimer(ID: number, Ms: number): Promise<ResultTuple<TimerView>>;
  ControlAllTimers(Action: ControlAction): Promise<ResultTuple<number>>;
  ControlTimers(IDs: number[], Action: ControlAction): Promise<ResultTuple<number>>;
  DeleteTimers(IDs: number[]): Promise<ResultTuple<number>>;
  MoveTimersToGroup(IDs: number[], GroupID: number | null): Promise<ResultTuple<number>>;
  ArrangeTimers(Layout: TimerPlacementView[]): Promise<ResultTuple<true>>;
  OnTimers(Callback: (Timers: TimerView[]) => void): Unsubscribe;
  OnTimerEvent(Callback: (Event: TimerEventView) => void): Unsubscribe;

  ListGroups(): Promise<GroupView[]>;
  CreateGroup(Patch: GroupPatchView): Promise<ResultTuple<GroupView>>;
  UpdateGroup(ID: number, Patch: GroupPatchView): Promise<ResultTuple<GroupView>>;
  DeleteGroup(ID: number): Promise<ResultTuple<true>>;
  ReorderGroups(IDs: number[]): Promise<ResultTuple<true>>;
  OnGroups(Callback: (Groups: GroupView[]) => void): Unsubscribe;

  GetCurrentShowFile(): Promise<string | null>;
  NewShow(): Promise<ResultTuple<string>>;
  OpenShow(): Promise<ResultTuple<ShowFileOpenOutcome>>;
  SaveShow(): Promise<ResultTuple<string>>;
  SaveShowAs(): Promise<ResultTuple<string>>;
  CheckShowFileUpgrade(): Promise<ResultTuple<ShowFileUpgrade | null>>;
  ResolveShowFileUpgrade(
    Accept: boolean
  ): Promise<ResultTuple<ShowFileUpgradeAcceptedView | ShowFileUpgradeDeclinedView>>;
  HasUnsavedShowData(): Promise<boolean>;
  EnsureShowFileExists(): Promise<ResultTuple<{ Missing: boolean; FilePath?: string }>>;
  OnShowFile(Callback: (State: ShowFileStateView) => void): Unsubscribe;
  /** The show file the operating system asked to open, if one is waiting. */
  TakeShowFileRequest(): Promise<ResultTuple<ShowFileRequest | null>>;
  /** Open the file TakeShowFileRequest returned, once the operator has agreed. */
  OpenRequestedShow(): Promise<ResultTuple<ShowFileOpenOutcome>>;
  /** A show file was opened from the operating system: take it. */
  OnShowFileRequest(Callback: () => void): Unsubscribe;
  OpenBackupsFolder(): Promise<void>;

  ListSounds(): Promise<LibrarySoundView[]>;
  ImportSound(): Promise<ResultTuple<LibrarySoundView>>;
  UpdateSound(ID: string, Patch: SoundPatchView): Promise<ResultTuple<LibrarySoundView>>;
  DeleteSound(ID: string): Promise<ResultTuple<true>>;
  GetSoundData(ID: string): Promise<ResultTuple<SoundDataView>>;
  OnSounds(Callback: (Sounds: LibrarySoundView[]) => void): Unsubscribe;

  GetServicesStatus(): Promise<ServicesStatusView>;
  OnServicesStatus(Callback: (Status: ServicesStatusView) => void): Unsubscribe;
  OnWebDashboardClientCount(Callback: (Count: number) => void): Unsubscribe;
  GetOscRoutes(): Promise<OscRouteView[]>;

  OpenLogsFolder(): Promise<void>;
  OpenExternal(Link: ExternalLink): Promise<void>;
  GetDependencies(): Promise<ResultTuple<{ dependencies: DependencyView[] }>>;
  GetLicense(): Promise<ResultTuple<{ license: string }>>;

  CheckForAppUpdates(): Promise<void>;
  InstallAppUpdate(): Promise<void>;
  OnAppUpdateStatus(Callback: (Status: AppUpdateStatus) => void): Unsubscribe;

  OnNotify(Callback: (Message: string, Type: string, Duration: number | null) => void): Unsubscribe;
  OnAppMenuAction(Callback: (Action: string) => void): Unsubscribe;
  OnShutdownRequested(Callback: () => void): Unsubscribe;
  /** The main window entered or left native full screen (and once on load). */
  OnWindowFullscreenChanged(Callback: (IsFullscreen: boolean) => void): Unsubscribe;
  Shutdown(Confirmed?: boolean): Promise<void>;
}

/**
 * Which channel each TimersAPI method uses: what src/bridge_main.ts
 * implements. Invoke methods answer with InvokeMap[channel]['Result']; the
 * callbacks of subscribe methods receive PushMap[channel].
 */
export interface TimersAPIChannels {
  GetConfig: 'Config:Get';
  Loaded: 'Loaded';
  GetSettings: 'Settings:Get';
  SetSetting: 'Settings:Set';
  OnSettings: 'Settings:Updated';
  GetMode: 'Mode:Get';
  SetMode: 'Mode:Set';
  OnMode: 'Mode:Updated';
  ListTimers: 'Timers:List';
  GetTimer: 'Timer:Get';
  CreateTimer: 'Timer:Create';
  UpdateTimer: 'Timer:Update';
  DeleteTimer: 'Timer:Delete';
  ControlTimer: 'Timer:Control';
  JumpTimer: 'Timer:JumpTo';
  ControlAllTimers: 'Timers:ControlAll';
  ControlTimers: 'Timers:ControlMany';
  DeleteTimers: 'Timers:DeleteMany';
  MoveTimersToGroup: 'Timers:MoveToGroup';
  ArrangeTimers: 'Timers:Arrange';
  OnTimers: 'Timers:Updated';
  OnTimerEvent: 'Timer:Event';
  ListGroups: 'Groups:List';
  CreateGroup: 'Group:Create';
  UpdateGroup: 'Group:Update';
  DeleteGroup: 'Group:Delete';
  ReorderGroups: 'Groups:Reorder';
  OnGroups: 'Groups:Updated';
  GetCurrentShowFile: 'Show:GetCurrentFile';
  NewShow: 'Show:New';
  OpenShow: 'Show:Open';
  SaveShow: 'Show:Save';
  SaveShowAs: 'Show:SaveAs';
  CheckShowFileUpgrade: 'Show:CheckUpgrade';
  ResolveShowFileUpgrade: 'Show:ResolveUpgrade';
  HasUnsavedShowData: 'Show:HasUnsavedData';
  EnsureShowFileExists: 'Show:EnsureFileExists';
  OnShowFile: 'ShowFile:Updated';
  TakeShowFileRequest: 'Show:TakeOpenRequest';
  OpenRequestedShow: 'Show:OpenRequested';
  OnShowFileRequest: 'ShowFile:OpenRequested';
  OpenBackupsFolder: 'App:OpenBackupsFolder';
  ListSounds: 'Sounds:List';
  ImportSound: 'Sounds:Import';
  UpdateSound: 'Sounds:Update';
  DeleteSound: 'Sounds:Delete';
  GetSoundData: 'Sounds:GetData';
  OnSounds: 'Sounds:Updated';
  GetServicesStatus: 'Services:GetStatus';
  OnServicesStatus: 'Services:Status';
  OnWebDashboardClientCount: 'WebDashboard:ClientCount';
  GetOscRoutes: 'OSC:GetRoutes';
  OpenLogsFolder: 'App:OpenLogsFolder';
  OpenExternal: 'App:OpenExternal';
  GetDependencies: 'App:GetDependencies';
  GetLicense: 'App:GetLicense';
  CheckForAppUpdates: 'AppUpdate:Check';
  InstallAppUpdate: 'AppUpdate:Install';
  OnAppUpdateStatus: 'AppUpdate:Status';
  OnNotify: 'Notify';
  OnAppMenuAction: 'AppMenuAction';
  OnShutdownRequested: 'ShutdownRequested';
  OnWindowFullscreenChanged: 'MainWindowFullscreenChanged';
  Shutdown: 'Shutdown';
}

/**
 * `window.API` in the splash window, exposed by its own preload
 * (src/bridge_preloader.ts): the main window's GetConfig on the same channel,
 * and nothing else.
 */
export type PreloaderAPI = Pick<TimersAPI, 'GetConfig'>;
