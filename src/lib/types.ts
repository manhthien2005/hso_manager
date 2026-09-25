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
  /** JAR hash reported by the agent at boot; null when not yet reported. */
  jar_sha256?: string | null;
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
 * Three-state health:
 *   running   = process alive AND valid telemetry snapshot AND ctl==1
 *   degraded  = process alive AND (no snapshot yet OR ctl!=1)
 *   stopped   = process not running
 *
 * Health reflects process + telemetry/control validity.
 * Attack automation state (atkstate) is not a health signal.
 */
export type HealthStatus = "running" | "degraded" | "stopped";

export type CharacterSlot = 1 | 2 | 3;

export interface Account {
  id: string;
  deviceId: string;
  label: string;
  status: AccountStatus;
  characterName: string | null;
  serverId: number | null;
  /**
   * 1-based positional character index in the compact vanilla character list (1..3).
   * Defaults to 1.
   */
  character_slot?: CharacterSlot;
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
  /** 1-based positional character index (1..3). Defaults to 1. */
  character_slot?: CharacterSlot;
}

export interface UpdateAccountInput {
  accountId: string;
  label: string;
  serverIndex: number;
  credentials?: {
    username: string;
    password: string;
  };
  /** 1-based positional character index (1..3). When omitted, preserves existing slot. */
  character_slot?: CharacterSlot;
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
  | "close-viewer"
  | "detect-spots";

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
  spotScan?: SpotScanSnapshot;
  inventory?: InventoryCatalogPayload;
}

export interface InventoryItemCatalog {
  slot: number;
  template_id: number;
  category: number;
  base_name: string;
  display_name: string;
  level: number;
  tier: number;
  count: number;
  durability: number | null;
  bind: number | null;
  icon: number | null;
  candidate_for_enhancement: boolean;
}

export interface InventoryCatalogPayload {
  version: 1;
  bag_capacity: number;
  items: InventoryItemCatalog[];
}

/** Runtime status values for a spot scan operation. */
export type SpotScanStatus =
  | "pending"
  | "completed"
  | "empty"
  | "timeout"
  | "error";

/** A single detected monster group or spawn candidate from a spot scan. */
export interface SpotScanCandidate {
  x: number;
  y: number;
  mobCount: number;
  spreadRadius: number;
  mobName: string;
  mobLevel: number;
}

/** Parsed spot scan payload derived from account_runtime.snapshot['spot_scan']. */
export interface SpotScanSnapshot {
  scanId: string;
  status: SpotScanStatus;
  detectedAt?: number;
  mapId?: number;
  capturedZone?: number;
  candidates?: SpotScanCandidate[];
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

/** Provenance source for a saved farm spot. */
export type FarmSpotSource = "manual" | "detected" | "imported";

/**
 * User-owned monster-farming spot preset library model.
 * Decoupled from accounts, devices, and Control v13.
 */
export interface FarmSpot {
  id: string;
  userId: string;
  name: string;
  mapId: number;
  x: number;
  y: number;
  capturedZone: number;
  source: FarmSpotSource;
  createdAt: number;
  updatedAt: number;
}

export interface CreateFarmSpotInput {
  name: string;
  mapId: number;
  x: number;
  y: number;
  capturedZone?: number;
  source?: FarmSpotSource;
}

export interface UpdateFarmSpotInput {
  name?: string;
  mapId?: number;
  x?: number;
  y?: number;
  capturedZone?: number;
}

// =============================================================================
// Enhancement Queue v1 Domain Types (Task ENHANCE-05A)
// =============================================================================

export type EnhancementQueueJobStatus =
  | "DRAFT"
  | "QUEUED"
  | "RUNNING"
  | "PAUSING"
  | "PAUSED"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "MANUAL_REVIEW_REQUIRED";

export type EnhancementQueueItemStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "CANCELLED"
  | "MANUAL_REVIEW_REQUIRED";

export type EnhancementAttemptPhase =
  | "NONE"
  | "PREPARING"
  | "READY_TO_EXECUTE"
  | "EXECUTE_MAY_HAVE_BEEN_SENT"
  | "WAITING_RESULT"
  | "WAITING_SETTLEMENT"
  | "SETTLED";

export type EnhancementPaymentType = "GOLD" | "GEMS";

export type EnhancementCharmMode =
  | "NONE"
  | "CO_3_LA"
  | "CO_4_LA"
  | "AUTO_POLICY"
  | "THREE_LEAF"
  | "FOUR_LEAF";

export interface EnhancementQueueJob {
  id: string;
  accountId: string;
  deviceId: string;
  userId: string;
  status: EnhancementQueueJobStatus;
  activeItemId: string | null;
  activeAttemptUuid: string | null;
  activeCommandId: string | null;
  totalItems: number;
  completedItems: number;
  claimedBy: string | null;
  claimedAt: string | null;
  claimExpiresAt: string | null;
  pauseRequestedAt: string | null;
  cancelRequestedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

export interface EnhancementQueueItem {
  id: string;
  jobId: string;
  accountId: string;
  userId: string;
  queueOrder: number;
  capturedSlot: number;
  templateId: number;
  category: number;
  baseName: string;
  tier: number;
  icon: number | null;
  initialLevel: number;
  currentLevel: number;
  targetLevel: number;
  paymentType: EnhancementPaymentType;
  charmMode: EnhancementCharmMode;
  status: EnhancementQueueItemStatus;
  attemptCount: number;

  // Durable attempt phase tracking
  activeAttemptUuid: string | null;
  attemptPhase: EnhancementAttemptPhase;
  attemptExpectedLevel: number | null;
  attemptTargetLevel: number | null;
  attemptStartedAt: string | null;
  executeMayHaveBeenSentAt: string | null;
  attemptSettledAt: string | null;
  lastResultCode: string | null;

  // Authoritative item spend
  actualGoldSpent: number;
  actualGemSpent: number;
  actualMaterial1Spent: number;
  actualMaterial2Spent: number;
  actualMaterial3Spent: number;
  actualMaterial4Spent: number;
  actualCharmSpent: number;

  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EnhancementQueueJobSummary extends EnhancementQueueJob {
  actualGoldSpent: number;
  actualGemSpent: number;
  actualMaterial1Spent: number;
  actualMaterial2Spent: number;
  actualMaterial3Spent: number;
  actualMaterial4Spent: number;
  actualCharmSpent: number;
  totalAttemptCount: number;
}

