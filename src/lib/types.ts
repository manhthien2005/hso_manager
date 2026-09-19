/**
 * Shared domain types for Zeus Knight Cloud.
 * Single source of truth: UI, mock API and (later) Supabase all use these.
 * Field names mirror the planned Supabase `devices` / `accounts` tables.
 */

export interface User {
  id: string;
  /** Login handle; email optional because the mock user signs in with a username. */
  email: string | null;
  username: string;
  displayName: string;
}

export type DeviceStatus = "online" | "offline" | "error";

export interface Device {
  id: string;
  /** Device fingerprint reported by the Zeus Agent. */
  deviceId: string;
  userId: string;
  name: string;
  region: string;
  status: DeviceStatus;
  agentVersion: string;
  runtimeVersion: string;
  /** Epoch ms of the last agent heartbeat; null when the device never reported. */
  lastSeen: number | null;
  /** Whether the noVNC tunnel can be opened right now. */
  viewerAvailable: boolean;
  metrics: DeviceMetrics;
  /**
   * CTL_VERSION the jar in this container understands.
   * Read from zeus-jar.json at agent boot; reported to devices.jar_ctl_version.
   * Null when the agent has not yet reported (device never paired).
   */
  jar_ctl_version: number | null;
  /** noVNC URL when viewer is available; null otherwise. */
  viewer_url: string | null;
}

export interface DeviceMetrics {
  /** 0..100 */
  cpu: number;
  ramUsedMb: number;
  ramTotalMb: number;
  /** Seconds since boot; 0 while offline. */
  uptimeSeconds: number;
}

export type AccountStatus =
  | "running"
  | "starting"
  | "stopped"
  | "restarting"
  | "error"
  | "offline";

/**
 * Three-state health per WIRE-CONTRACT §6:
 *   running   = process alive AND ctl==1 AND atkstate>=0
 *   degraded  = process alive AND (ctl!=1 OR atkstate<0 OR snapshot unparseable)
 *   stopped   = process not running
 */
export type HealthStatus = "running" | "degraded" | "stopped";

export interface Account {
  id: string;
  deviceId: string;
  label: string;
  status: AccountStatus;
  characterName: string | null;
  serverId: number | null;
  /** Process memory of this emulator instance. */
  ramMb: number | null;
  pid: number | null;
  /** Legacy config shape (mock-api compat). Use `control` for the real 34-key wire block. */
  config: AccountConfig;
  /**
   * 34-key control block (zeus-control.txt without the 'v' key).
   * Null when no config has been saved yet.
   */
  control: Record<string, unknown> | null;
  /** CTL_VERSION this control block was written for. */
  control_version: number | null;
  /**
   * 'ok' | 'version_mismatch' | null.
   * 'version_mismatch' means the agent refused to write the last config
   * because control_version !== jar_ctl_version. Show a red banner.
   */
  config_status: string | null;
  /** Latest parsed snapshot from account_runtime.snapshot. */
  snapshot: PlayerSnapshot | null;
}

export interface AccountControlUpdate {
  control: Record<string, unknown>;
  controlVersion: number;
}

export interface CreateAccountInput {
  deviceId: string;
  label: string;
  username: string;
  password: string;
  serverIndex: number;
}

export interface AccountConfig {
  accountName: string;
  characterName: string;
  serverId: number;
  autoStart: boolean;
  autoRestart: boolean;
  memoryLimitMb: number;
  restartDelaySeconds: number;
  additionalArgs: string;
  automation: AutomationConfig;
}

export interface AutomationConfig {
  autoLogin: boolean;
  autoPickServer: boolean;
  /** Seconds to wait after the game window appears before sending input. */
  startupDelaySeconds: number;
  /** 0 disables the schedule. */
  restartEveryMinutes: number;
  followSchedule: boolean;
  /** `HH:mm` 24h; only meaningful when followSchedule is true. */
  activeFrom: string;
  activeTo: string;
}

export type CommandType =
  | "start"
  | "stop"
  | "restart"
  | "apply-config"
  | "open-viewer"
  | "close-viewer";

export type CommandStatus =
  | "queued"
  | "running"
  | "success"
  | "failed"
  | "expired";

/** Write intent sent to the Supabase `commands` table; the agent drains it. */
export interface Command {
  id: string;
  accountId: string;
  deviceId: string;
  type: CommandType;
  status: CommandStatus;
  createdAt: number;
  finishedAt: number | null;
  message: string | null;
}

/** Live, non-persisted agent state shown in the UI. */
export interface RuntimeStatus {
  deviceId: string;
  status: DeviceStatus;
  metrics: DeviceMetrics;
  accounts: Array<Pick<Account, "id" | "status" | "ramMb" | "pid">>;
}

/**
 * Snapshot published by the jar to zeus-player.txt (v=6, 48 keys).
 * Null fields mean the jar has not yet delivered that opcode.
 * WIRE-CONTRACT §5.
 */
export interface PlayerSnapshot {
  v: number;
  t: number;
  name: string | null;
  lv: number;
  xp: number;          // permille (0..1000) — render as bA/10 + "," + bA%10 + "%"
  hp: number;
  hpmax: number;
  mp: number;
  mpmax: number;
  map: number;
  zone: number;
  px: number;
  py: number;
  gold: number | null; // null until opcode 16 delivers the wallet
  gem: number | null;
  wallet: number | null;
  guild: string | null;
  bag: number;
  bagmax: number;
  mount: number;
  mounts: string;
  buffs: string;
  drops: string;
  state: number;
  stale: number;
  quota: number;       // <=0 means auto stopped
  potions: number;
  revives: number;
  atkphase: number;
  atkstate: number;    // -1=none / 0=fighting / 1=returning / 2=stabilising
  target: number;
  stuck: number;       // 0=ok / 1=no mobs / 2=terrain stuck
  pkrank: number;
  pkmphp: number;
  pkgold: number;
  travel: number;
  travelstate: number;
  travelgoal: number;
  travelhops: number;
  travelwhy: string;
  dungeonstate: number;
  dungeonruns: number;
  dungeongoal: number;
  dungeonwhy: string;
  enhancephase: number;
  enhancedone: number;
  enhancewhy: string;
  xprate: number;
  ctl: number;         // -1=no property / 0=parse fail / 1=ok
}

export type ViewerTransport = "novnc" | "mock";

export interface ViewerSession {
  id: string;
  deviceId: string;
  /** Where noVNC will point once the Railway tunnel exists. */
  url: string | null;
  transport: ViewerTransport;
  state: "connecting" | "connected" | "closed" | "error";
  createdAt: number;
  /** Shown when the session is not real yet (mock phase). */
  reason: string | null;
}

export type ToastTone = "success" | "error" | "info";

export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
}

/** Aggregate the dashboard header needs; computed from devices + accounts. */
export interface FleetSummary {
  devices: number;
  accounts: number;
  running: number;
  stopped: number;
  error: number;
  devicesOnline: number;
}

/**
 * Sealed credential payload matching the Zeus Agent SealedSecret wire contract.
 * Alg: ECDH-P256 -> HKDF-SHA256 -> AES-256-GCM.
 */
export interface SealedCredentials {
  alg: "ecdh-p256-hkdf-sha256-aes256gcm";
  info: "zeus-v1";
  eph_pub: string;
  nonce: string;
  ct: string;
}

