// Socket.IO event maps for the default (ShowTrak client agent) namespace.
// These can be used to strongly type `socket.io` Server/Socket generics on the
// server and the client SDK.

import type {
  HeartbeatPayload,
  SystemInfoPayload,
  USBDevice,
  ClientDisplay,
  NetworkInterface,
  RunningApplicationsSnapshot,
  NetworkInterfaceDelta,
  DisplayDelta,
  ApplicationDelta,
  ServerCapabilities,
} from './telemetry';
import type { AdoptionHeartbeatPayload, UnadoptPayload, IdentifyPayload } from './adoption';
import type { IntegratedAction, IntegratedState } from './integrated';
import type {
  ExecutionRequestID,
  LaunchConfigPayload,
  UpdateSoftwareFromLANPayload,
} from './execution';
import type { VariableEnvironment, VariablePayload } from './variables';

/** Events emitted by the client and handled by the server. */
export interface ClientToServerEvents {
  AdoptionHeartbeat: (data: AdoptionHeartbeatPayload) => void;
  GetScripts: (callback: (scripts: unknown) => void) => void;
  GetLaunchConfig: (callback: (config: LaunchConfigPayload) => void) => void;
  /**
   * Fetch this client's resolved show variables. Requested once per connection,
   * before the run-on-launch sequence hands off, so a launch script sees the
   * same values a server-dispatched one would.
   *
   * A server that predates variables has no handler and never acks, which the
   * client treats as "no variables" — the same absence-is-the-answer pattern
   * `GetServerCapabilities` uses.
   */
  GetVariables: (callback: (payload: VariablePayload) => void) => void;
  RegisterActions: (actions: IntegratedAction[]) => void;
  IntegratedEventResponse: (requestId: ExecutionRequestID, error: string | null) => void;
  /**
   * Optional progress line for an in-flight integrated event, shown in the
   * execution UI in place of the row's status text. Ignored once the event has
   * settled. Messages are capped at 255 characters.
   */
  IntegratedEventFeedback: (requestId: ExecutionRequestID, message: string) => void;
  SetIntegratedState: (state: IntegratedState | string, message?: string | null) => void;
  Heartbeat: (data: HeartbeatPayload) => void;
  SystemInfo: (data: SystemInfoPayload) => void;
  USBDeviceList: (devices: USBDevice[]) => void;
  USBDeviceConnected: (device: USBDevice) => void;
  USBDeviceDisconnected: (device: USBDevice) => void;
  DisplayList: (displays: ClientDisplay[]) => void;
  NetworkInterfaces: (interfaces: NetworkInterface[]) => void;
  RunningApplications: (snapshot: RunningApplicationsSnapshot) => void;
  /**
   * Ask what the server understands. A server that predates this event never
   * invokes the callback, which is how the client detects an older server and
   * stays on full-list reporting.
   */
  GetServerCapabilities: (callback: (capabilities: ServerCapabilities) => void) => void;
  /**
   * Incremental telemetry. Only emitted once the server has advertised
   * `Deltas`; the full-list events above stay authoritative and continue on
   * connect and on the periodic resync.
   */
  NetworkInterfaceDelta: (delta: NetworkInterfaceDelta) => void;
  DisplayDelta: (delta: DisplayDelta) => void;
  ApplicationDelta: (delta: ApplicationDelta) => void;
  IdentifyStopped: () => void;
  ScriptExecutionResponse: (
    requestId: ExecutionRequestID,
    error: string | null,
    result?: unknown
  ) => void;
  ScriptExecutionProgress: (
    requestId: ExecutionRequestID,
    progress: number,
    statusText: string
  ) => void;
}

/** Events emitted by the server and handled by the client. */
export interface ServerToClientEvents {
  Adopt: () => void;
  Unadopt: (info: UnadoptPayload) => void;
  UpdateSoftware: (requestId: ExecutionRequestID) => void;
  UpdateSoftwareFromLAN: (
    requestId: ExecutionRequestID,
    payload: UpdateSoftwareFromLANPayload
  ) => void;
  DeleteScripts: (requestId: ExecutionRequestID) => void;
  UpdateScripts: (requestId: ExecutionRequestID) => void;
  /**
   * `variables` is resolved at dispatch time, not at enqueue time, so a script
   * that waited its turn behind another runs with the values that were current
   * when it actually started. It is optional purely for wire compatibility: an
   * older server omits it and the client falls back to its pushed cache.
   */
  ExecuteScript: (
    requestId: ExecutionRequestID,
    scriptId: string,
    variables?: VariableEnvironment
  ) => void;
  TriggerIntegratedEvent: (requestId: ExecutionRequestID, eventId: string) => void;
  /**
   * Re-push the client's resolved variables after any change to a definition or
   * to this client's overrides. Editing a *default* moves every client that has
   * not overridden it, so definition changes fan out to all connected clients
   * while an override change targets the one room.
   */
  SetVariables: (payload: VariablePayload) => void;
  Identify: (payload: IdentifyPayload) => void;
  /** Clears an active Identify overlay. Emitted by the server's IdentifyManager. */
  StopIdentify: () => void;
}
