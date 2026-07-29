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

/** Events emitted by the client and handled by the server. */
export interface ClientToServerEvents {
  AdoptionHeartbeat: (data: AdoptionHeartbeatPayload) => void;
  GetScripts: (callback: (scripts: unknown) => void) => void;
  GetLaunchConfig: (callback: (config: LaunchConfigPayload) => void) => void;
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
  ExecuteScript: (requestId: ExecutionRequestID, scriptId: string) => void;
  TriggerIntegratedEvent: (requestId: ExecutionRequestID, eventId: string) => void;
  Identify: (payload: IdentifyPayload) => void;
  /** Clears an active Identify overlay. Emitted by the server's IdentifyManager. */
  StopIdentify: () => void;
}
