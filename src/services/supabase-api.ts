/**
 * supabase-api.ts — Supabase implementation of ZeusApi.
 *
 * Swap ra: `api.ts` line 99: `export const api: ZeusApi = supabaseApi;`
 *
 * ## Thiết kế
 *
 * - Mọi query dùng RLS: user chỉ thấy device + account của chính mình.
 * - Realtime: subscribe `devices`, `accounts`, `account_runtime`, `commands` qua
 *   supabase.channel() — Supabase JS SDK tự lo Phoenix protocol.
 * - Write path (sendCommand, updateAccountConfig): INSERT/PATCH qua PostgREST.
 * - State synchronization: `onUpdate` drives từ realtime, command execution awaits terminal status via sequential polling.
 *
 * ## Mapping DB → frontend types
 *
 * DB schema (snake_case) ↔ frontend types (camelCase):
 *   devices.status         → Device.status (online/offline/degraded)
 *   account_runtime.process_state → Account.status
 *   devices.jar_ctl_version → Device.jar_ctl_version
 */

import { supabase } from "@/lib/supabase";
import { sanitizeViewerUrl } from "@/lib/format";
import { sealCredentials, type SealedCredentials } from "@/lib/credential-sealing";
import {
  CONTROL_SCHEMA,
  defaultControlDraft,
  draftToControlRecord,
  validateDraft,
} from "@/lib/config-schema";
import { isValidCharacterSlot } from "@/lib/capabilities";
import { parseInventoryPayload } from "@/lib/inventory";
import type { QueueItemSubmissionPayload } from "@/lib/queue";
import type {
  Account,
  AccountConfig,
  AccountControlUpdate,
  CharacterSlot,
  Command,
  CommandStatus,
  CommandType,
  CreateAccountInput,
  Device,
  DeviceMetrics,
  EnhancementQueueJob,
  FarmSpot,
  FarmSpotSource,
  CreateFarmSpotInput,
  UpdateFarmSpotInput,
  PlayerSnapshot,
  SpotScanCandidate,
  SpotScanSnapshot,
  SpotScanStatus,
  UpdateAccountInput,
  User,
  ViewerSession,
} from "@/lib/types";
import {
  executeStartQueueFlow,
  executePauseQueueFlow,
  executeCancelQueueFlow,
  mapQueueJobRow,
  fetchActiveQueueWithItems,
  fetchRecentQueueHistory,
} from "@/services/queue-service";
import type { AuthoritativeQueueWithItems } from "@/lib/queue-progress";
import type {
  ZeusApi,
  LoginCredentials,
  SendCommandInput,
  CommandResult,
  UpdateListener,
} from "@/services/api";
import { ApiError, CommandFailedError } from "@/services/api";
import type { Database } from "@/lib/database.types";

type DeviceRow = Database["public"]["Tables"]["devices"]["Row"];
type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];
type RuntimeRow = Database["public"]["Tables"]["account_runtime"]["Row"];
type CommandRow = Database["public"]["Tables"]["commands"]["Row"];
type FarmSpotRow = Database["public"]["Tables"]["farm_spots"]["Row"];

// ── mappers ──────────────────────────────────────────────────────────────────

export function mapFarmSpot(row: FarmSpotRow): FarmSpot {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    mapId: row.map_id,
    x: row.x,
    y: row.y,
    capturedZone: row.captured_zone,
    source: (row.source as FarmSpotSource) || "manual",
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

function mapDevice(row: DeviceRow): Device {
  const metrics: DeviceMetrics = {
    cpu: row.cpu_pct ?? 0,
    ramUsedMb: row.ram_used_mb ?? 0,
    ramTotalMb: row.ram_total_mb ?? 0,
    uptimeSeconds: row.uptime_s ?? 0,
  };
  return {
    id: row.id,
    deviceId: row.id,
    userId: row.user_id ?? "",
    name: row.name,
    region: "Railway",
    status:
      row.status === "online"
        ? "online"
        : row.status === "degraded"
          ? "error"
          : "offline",
    agentVersion: row.agent_version ?? "unknown",
    runtimeVersion: String(row.jar_ctl_version ?? 0),
    lastSeen: row.last_seen ? new Date(row.last_seen).getTime() : null,
    viewerAvailable: Boolean(
      row.viewer_url && row.viewer_expires_at && new Date(row.viewer_expires_at) > new Date()
    ),
    metrics,
    jar_ctl_version: row.jar_ctl_version,
    jar_sha256: row.jar_sha256,
    viewer_url: row.viewer_url,
  };
}

const VALID_SPOT_SCAN_STATUSES = new Set<SpotScanStatus>([
  "pending",
  "completed",
  "empty",
  "timeout",
  "error",
]);

export function mapSpotScanCandidate(raw: unknown): SpotScanCandidate | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const rec = raw as Record<string, unknown>;

  const x = rec.x;
  const y = rec.y;
  const mobCount = rec.mob_count ?? rec.mobCount;
  const spreadRadius = rec.spread_radius ?? rec.spreadRadius;
  const mobName = rec.mob_name ?? rec.mobName;
  const mobLevel = rec.mob_level ?? rec.mobLevel;

  if (typeof x !== "number" || !Number.isFinite(x) || x < 0) {
    return null;
  }
  if (typeof y !== "number" || !Number.isFinite(y) || y < 0) {
    return null;
  }
  if (typeof mobCount !== "number" || !Number.isFinite(mobCount) || mobCount < 0) {
    return null;
  }
  if (typeof spreadRadius !== "number" || !Number.isFinite(spreadRadius) || spreadRadius < 0) {
    return null;
  }
  if (typeof mobName !== "string" || mobName.length === 0) {
    return null;
  }
  if (typeof mobLevel !== "number" || !Number.isFinite(mobLevel)) {
    return null;
  }

  return {
    x,
    y,
    mobCount: Math.floor(mobCount),
    spreadRadius,
    mobName,
    mobLevel: Math.floor(mobLevel),
  };
}

export function mapSpotScanSnapshot(raw: unknown): SpotScanSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const rec = raw as Record<string, unknown>;

  const rawScanId = rec.scan_id ?? rec.scanId;
  if (typeof rawScanId !== "string" || rawScanId.trim().length === 0) {
    return null;
  }
  const scanId = rawScanId.trim();

  const rawStatus = rec.status;
  if (typeof rawStatus !== "string" || !VALID_SPOT_SCAN_STATUSES.has(rawStatus as SpotScanStatus)) {
    return null;
  }
  const status = rawStatus as SpotScanStatus;

  const result: SpotScanSnapshot = {
    scanId,
    status,
  };

  const rawDetectedAt = rec.detected_at ?? rec.detectedAt;
  if (typeof rawDetectedAt === "string") {
    const parsed = new Date(rawDetectedAt).getTime();
    if (!Number.isNaN(parsed)) {
      result.detectedAt = parsed;
    }
  } else if (typeof rawDetectedAt === "number" && Number.isFinite(rawDetectedAt) && rawDetectedAt > 0) {
    result.detectedAt = rawDetectedAt;
  }

  const rawMapId = rec.map_id ?? rec.mapId;
  if (typeof rawMapId === "number" && Number.isFinite(rawMapId) && rawMapId >= 0) {
    result.mapId = Math.floor(rawMapId);
  }

  const rawCapturedZone = rec.captured_zone ?? rec.capturedZone;
  if (typeof rawCapturedZone === "number" && Number.isFinite(rawCapturedZone)) {
    result.capturedZone = Math.floor(rawCapturedZone);
  }

  const rawCandidates = rec.candidates;
  if (Array.isArray(rawCandidates)) {
    const parsedCandidates: SpotScanCandidate[] = [];
    for (const item of rawCandidates) {
      const candidate = mapSpotScanCandidate(item);
      if (candidate) {
        parsedCandidates.push(candidate);
      }
    }
    result.candidates = parsedCandidates;
  }

  return result;
}

export function mapPlayerSnapshot(
  raw: Record<string, unknown> | null | undefined,
): PlayerSnapshot | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  // Preserve every currently supported PlayerSnapshot field and unknown/additional keys
  const { spot_scan, spotScan, inventory, ...telemetry } = raw;
  const snapshot = { ...telemetry } as unknown as PlayerSnapshot;

  const rawSpotScan = spot_scan ?? spotScan;
  if (rawSpotScan !== undefined && rawSpotScan !== null) {
    const parsed = mapSpotScanSnapshot(rawSpotScan);
    if (parsed) {
      snapshot.spotScan = parsed;
    }
  }

  if (inventory !== undefined && inventory !== null) {
    const parsedInventory = parseInventoryPayload(inventory);
    if (parsedInventory) {
      snapshot.inventory = parsedInventory;
    }
  }

  return snapshot;
}

export function mapAccount(acc: AccountRow, rt?: RuntimeRow | null): Account {
  const processState = rt?.process_state ?? "stopped";
  const status: import("@/lib/types").AccountStatus =
    processState === "running"
      ? "running"
      : processState === "starting"
        ? "starting"
        : processState === "crashed"
          ? "error"
          : "stopped";

  const snapshot = mapPlayerSnapshot(rt?.snapshot);
  const charName =
    typeof snapshot?.name === "string" && snapshot.name.length > 0
      ? snapshot.name
      : null;
  const serverId = acc.server_index;

  // Build a minimal AccountConfig (legacy shape)
  const config: AccountConfig = {
    accountName: acc.username,
    characterName: charName ?? "",
    serverId: acc.server_index,
    autoStart: true,
    autoRestart: true,
    memoryLimitMb: 320,
    restartDelaySeconds: 5,
    additionalArgs: "",
    automation: {
      autoLogin: true,
      autoPickServer: true,
      startupDelaySeconds: 3,
      restartEveryMinutes: 0,
      followSchedule: false,
      activeFrom: "00:00",
      activeTo: "23:59",
    },
  };

  return {
    id: acc.id,
    deviceId: acc.device_id,
    label: acc.label,
    status,
    characterName: charName,
    serverId,
    character_slot: (acc.character_slot ?? 1) as CharacterSlot,
    ramMb: rt?.ram_mb ?? null,
    pid: rt?.pid ?? null,
    config,
    control: (acc.control ?? {}) as Record<string, unknown>,
    control_version: acc.control_version,
    config_status: rt?.config_status ?? null,
    snapshot,
  };
}

function mapCommand(row: CommandRow): Command {
  return {
    id: row.id,
    accountId: row.account_id ?? "",
    deviceId: row.device_id,
    type: row.type as CommandType,
    status: row.status as CommandStatus,
    createdAt: new Date(row.created_at).getTime(),
    finishedAt: row.finished_at ? new Date(row.finished_at).getTime() : null,
    message: row.message ?? null,
  };
}

// ── implementation ───────────────────────────────────────────────────────────

export class SupabaseApi implements ZeusApi {
  // ── auth ─────────────────────────────────────────────────────────────────


  async getSession(): Promise<User | null> {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.user) return null;
    const u = data.session.user;
    return {
      id: u.id,
      email: u.email ?? null,
      username: u.email?.split("@")[0] ?? u.id,
      displayName: u.user_metadata?.["display_name"] ?? u.email ?? u.id,
    };
  }

  async login({ username, password }: LoginCredentials): Promise<User> {
    // username được truyền vào thực ra là email trong Supabase Auth.
    const { data, error } = await supabase.auth.signInWithPassword({
      email: username.includes("@") ? username : `${username}@hso.com`,
      password,
    });
    if (error) throw new ApiError("AUTH_FAILED", error.message);
    const u = data.user!;
    return {
      id: u.id,
      email: u.email ?? null,
      username: u.email?.split("@")[0] ?? u.id,
      displayName: u.user_metadata?.["display_name"] ?? u.email ?? u.id,
    };
  }

  async logout(): Promise<void> {
    await supabase.auth.signOut();
  }

  // ── devices ───────────────────────────────────────────────────────────────

  async getDevices(): Promise<Device[]> {
    const { data, error } = await supabase
      .from("devices")
      .select("*")
      .order("created_at", { ascending: true });
    if (error) throw new ApiError("FETCH_DEVICES", error.message);
    return (data ?? []).map((r) => mapDevice(r));
  }

  async getDevice(deviceId: string): Promise<Device | null> {
    const { data, error } = await supabase
      .from("devices")
      .select("*")
      .eq("id", deviceId)
      .maybeSingle();
    if (error) throw new ApiError("FETCH_DEVICE", error.message);
    return data ? mapDevice(data) : null;
  }

  async refreshDevice(deviceId: string): Promise<Device> {
    const device = await this.getDevice(deviceId);
    if (!device) throw new ApiError("NOT_FOUND", `Device ${deviceId} not found`);
    return device;
  }

  // ── accounts ──────────────────────────────────────────────────────────────

  async getAccounts(deviceId?: string): Promise<Account[]> {
    let q = supabase
      .from("accounts")
      .select("*, account_runtime(*)")
      .order("slot_index", { ascending: true });
    if (deviceId) q = q.eq("device_id", deviceId);

    const { data, error } = await q;
    if (error) throw new ApiError("FETCH_ACCOUNTS", error.message);
    return (data ?? []).map((row) => {
      const { account_runtime: rt, ...acc } = row as AccountRow & {
        account_runtime: RuntimeRow | null;
      };
      return mapAccount(acc, rt);
    });
  }

  async getAccount(accountId: string): Promise<Account | null> {
    const { data, error } = await supabase
      .from("accounts")
      .select("*, account_runtime(*)")
      .eq("id", accountId)
      .maybeSingle();
    if (error) throw new ApiError("FETCH_ACCOUNT", error.message);
    if (!data) return null;
    const { account_runtime: rt, ...acc } = data as AccountRow & {
      account_runtime: RuntimeRow | null;
    };
    return mapAccount(acc, rt);
  }

  async createAccount(input: CreateAccountInput): Promise<Account> {
    // 1. Basic input validation
    if (!input.deviceId || typeof input.deviceId !== "string" || input.deviceId.trim().length === 0) {
      throw new ApiError("INVALID_ACCOUNT_INPUT", "Device ID is required");
    }
    if (!input.label || typeof input.label !== "string" || input.label.trim().length === 0) {
      throw new ApiError("INVALID_ACCOUNT_INPUT", "Account label must not be empty");
    }
    if (!input.username || typeof input.username !== "string" || input.username.trim().length === 0) {
      throw new ApiError("INVALID_ACCOUNT_INPUT", "Username must not be empty");
    }
    if (!input.password || typeof input.password !== "string" || input.password.length === 0) {
      throw new ApiError("INVALID_ACCOUNT_INPUT", "Password must not be empty");
    }
    if (
      typeof input.serverIndex !== "number" ||
      !Number.isInteger(input.serverIndex) ||
      input.serverIndex < 0 ||
      input.serverIndex > 7
    ) {
      throw new ApiError(
        "INVALID_ACCOUNT_INPUT",
        "Server index must be an integer between 0 and 7",
      );
    }

    // 1. Basic input validation
    const characterSlot = input.character_slot ?? 1;
    if (!isValidCharacterSlot(characterSlot)) {
      throw new ApiError(
        "INVALID_ACCOUNT_INPUT",
        `Invalid character slot: ${input.character_slot}. Must be 1, 2, or 3.`,
      );
    }

    // 2. Load and validate target device
    const device = await this.getDevice(input.deviceId);
    if (!device) {
      throw new ApiError("NOT_FOUND", `Device ${input.deviceId} not found`);
    }

    const ctlVersion = device.jar_ctl_version;
    if (ctlVersion === null || ctlVersion <= 0 || !CONTROL_SCHEMA[ctlVersion]) {
      throw new ApiError(
        "UNSUPPORTED_CTL_VERSION",
        `Device ${input.deviceId} has unsupported or missing CTL version (${ctlVersion ?? "null"})`,
      );
    }

    // 3. Build and validate canonical default control block
    const draft = defaultControlDraft(ctlVersion);
    const validationErrors = validateDraft(draft, ctlVersion);
    if (Object.keys(validationErrors).length > 0) {
      throw new ApiError(
        "INVALID_CONTROL_DEFAULT",
        `Default control block is invalid for CTL version ${ctlVersion}: ${Object.values(validationErrors).join(", ")}`,
      );
    }
    const control = draftToControlRecord(draft, ctlVersion);

    // 4. Fetch canonical device sealing pubkey RPC
    const { data: pubkey, error: pubkeyError } = await supabase.rpc(
      "get_device_sealing_pubkey",
      {
        p_device_id: input.deviceId,
      },
    );
    if (pubkeyError) {
      throw new ApiError("FETCH_SEALING_KEY", pubkeyError.message);
    }
    if (!pubkey || typeof pubkey !== "string" || pubkey.trim().length === 0) {
      throw new ApiError(
        "FETCH_SEALING_KEY",
        `Device ${input.deviceId} has no valid sealing public key`,
      );
    }

    // 5. Seal credentials in browser
    let sealed: SealedCredentials;
    try {
      sealed = await sealCredentials(pubkey, input.username, input.password);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to seal credentials";
      throw new ApiError("SEAL_CREDENTIALS", message);
    }

    // 6. Call atomic create_game_account RPC
    const { data: newAccountId, error: createError } = await supabase.rpc(
      "create_game_account",
      {
        p_device_id: input.deviceId,
        p_label: input.label,
        p_username: input.username,
        p_secret_sealed: sealed as unknown as Record<string, unknown>,
        p_server_index: input.serverIndex,
        p_control_version: ctlVersion,
        p_control: control,
        p_character_slot: characterSlot,
      },
    );
    if (createError) {
      throw new ApiError("CREATE_ACCOUNT", createError.message);
    }
    if (!newAccountId) {
      throw new ApiError("CREATE_ACCOUNT", "create_game_account returned no account ID");
    }

    // 7. Fetch newly-created Account with runtime
    const account = await this.getAccount(newAccountId);
    if (!account) {
      throw new ApiError(
        "FETCH_ACCOUNT",
        `Created account ${newAccountId} could not be retrieved`,
      );
    }

    return account;
  }

  async updateAccount(input: UpdateAccountInput): Promise<Account> {
    // 1. Basic input validation
    if (!input.accountId || typeof input.accountId !== "string" || input.accountId.trim().length === 0) {
      throw new ApiError("INVALID_ACCOUNT_INPUT", "Account ID is required");
    }
    if (!input.label || typeof input.label !== "string" || input.label.trim().length === 0) {
      throw new ApiError("INVALID_ACCOUNT_INPUT", "Account label must not be empty");
    }
    if (
      typeof input.serverIndex !== "number" ||
      !Number.isInteger(input.serverIndex) ||
      input.serverIndex < 0 ||
      input.serverIndex > 7
    ) {
      throw new ApiError(
        "INVALID_ACCOUNT_INPUT",
        "Server index must be an integer between 0 and 7",
      );
    }

    let usernameArg: string | null = null;
    let secretSealedArg: Record<string, unknown> | null = null;

    if (input.credentials !== undefined) {
      const { username, password } = input.credentials;
      if (!username || typeof username !== "string" || username.trim().length === 0) {
        throw new ApiError("INVALID_ACCOUNT_INPUT", "Username must not be empty");
      }
      if (!password || typeof password !== "string" || password.length === 0) {
        throw new ApiError("INVALID_ACCOUNT_INPUT", "Password must not be empty");
      }

      // 1. Resolve current account to obtain target deviceId
      const account = await this.getAccount(input.accountId);
      if (!account) {
        throw new ApiError("NOT_FOUND", `Account ${input.accountId} not found`);
      }

      // 2. Fetch canonical device sealing pubkey RPC
      const { data: pubkey, error: pubkeyError } = await supabase.rpc(
        "get_device_sealing_pubkey",
        {
          p_device_id: account.deviceId,
        },
      );
      if (pubkeyError) {
        throw new ApiError("FETCH_SEALING_KEY", pubkeyError.message);
      }
      if (!pubkey || typeof pubkey !== "string" || pubkey.trim().length === 0) {
        throw new ApiError(
          "FETCH_SEALING_KEY",
          `Device ${account.deviceId} has no valid sealing public key`,
        );
      }

      // 3. Seal credentials in browser
      let sealed: SealedCredentials;
      try {
        sealed = await sealCredentials(pubkey, username, password);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to seal credentials";
        throw new ApiError("SEAL_CREDENTIALS", message);
      }

      usernameArg = username;
      secretSealedArg = sealed as unknown as Record<string, unknown>;
    }

    let characterSlotArg: CharacterSlot | null = null;
    if (input.character_slot !== undefined) {
      if (!isValidCharacterSlot(input.character_slot)) {
        throw new ApiError(
          "INVALID_ACCOUNT_INPUT",
          `Invalid character slot: ${input.character_slot}. Must be 1, 2, or 3.`,
        );
      }
      characterSlotArg = input.character_slot;
    }

    // 4. Call atomic update_game_account RPC
    const { data: updatedId, error: updateError } = await supabase.rpc(
      "update_game_account",
      {
        p_account_id: input.accountId,
        p_label: input.label.trim(),
        p_server_index: input.serverIndex,
        p_username: usernameArg,
        p_secret_sealed: secretSealedArg,
        p_character_slot: characterSlotArg,
      },
    );

    if (updateError) {
      throw new ApiError("UPDATE_ACCOUNT", updateError.message);
    }
    if (!updatedId) {
      throw new ApiError("UPDATE_ACCOUNT", "update_game_account returned no account ID");
    }
    if (updatedId !== input.accountId) {
      throw new ApiError(
        "UPDATE_ACCOUNT",
        `Returned account ID mismatch: expected ${input.accountId}, got ${updatedId}`,
      );
    }

    // 5. Re-fetch the account using existing canonical path
    const updatedAccount = await this.getAccount(input.accountId);
    if (!updatedAccount) {
      throw new ApiError(
        "FETCH_ACCOUNT",
        `Updated account ${input.accountId} could not be retrieved`,
      );
    }

    return updatedAccount;
  }

  async updateAccountConfig(
    accountId: string,
    input: AccountControlUpdate,
  ): Promise<Account> {
    // config_version bump signals the agent that new config needs applying.
    const { data: existing, error: lookupError } = (await supabase
      .from("accounts")
      .select("config_version")
      .eq("id", accountId)
      .maybeSingle()) as {
        data: { config_version: number } | null;
        error: import("@supabase/supabase-js").PostgrestError | null;
      };

    if (lookupError) throw new ApiError("FETCH_ACCOUNT", lookupError.message);
    if (!existing) throw new ApiError("NOT_FOUND", `Account ${accountId} not found`);

    const nextVersion = (existing.config_version ?? 0) + 1;

    const updatePayload = {
      control: input.control,
      control_version: input.controlVersion,
      config_version: nextVersion,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await (supabase
      .from("accounts") as unknown as {
        update(v: typeof updatePayload): {
          eq(col: string, val: string): {
            select(q: string): {
              single(): Promise<{
                data: (AccountRow & { account_runtime: RuntimeRow | null }) | null;
                error: import("@supabase/supabase-js").PostgrestError | null;
              }>;
            };
          };
        };
      })
      .update(updatePayload)
      .eq("id", accountId)
      .select("*, account_runtime(*)")
      .single();

    if (error) throw new ApiError("UPDATE_CONFIG", error.message);
    if (!data) throw new ApiError("NOT_FOUND", `Account ${accountId} not found after update`);
    const { account_runtime: rt, ...acc } = data;
    return mapAccount(acc, rt);
  }

  async deleteAccount(
    accountId: string,
    stopCommandId: string,
  ): Promise<string> {
    if (!accountId || typeof accountId !== "string" || accountId.trim().length === 0) {
      throw new ApiError("INVALID_ACCOUNT_INPUT", "Account ID is required");
    }
    if (!stopCommandId || typeof stopCommandId !== "string" || stopCommandId.trim().length === 0) {
      throw new ApiError("INVALID_STOP_COMMAND_INPUT", "Stop command ID is required");
    }

    const { data: deletedId, error: deleteError } = await supabase.rpc(
      "delete_game_account",
      {
        p_account_id: accountId,
        p_stop_command_id: stopCommandId,
      },
    );

    if (deleteError) {
      throw new ApiError("DELETE_ACCOUNT", deleteError.message);
    }
    if (!deletedId) {
      throw new ApiError("DELETE_ACCOUNT", "delete_game_account returned no account ID");
    }
    if (deletedId !== accountId) {
      throw new ApiError(
        "DELETE_ACCOUNT",
        `Returned account ID mismatch: expected ${accountId}, got ${deletedId}`,
      );
    }

    return deletedId;
  }

  // ── commands ──────────────────────────────────────────────────────────────

  async sendCommand({ accountId, type }: SendCommandInput): Promise<CommandResult> {
    const COMMAND_POLL_INTERVAL_MS = 400;
    const COMMAND_TIMEOUT_MS = 30_000;

    // 1. Get account + device first to validate ownership & existence.
    const account = await this.getAccount(accountId);
    if (!account) throw new ApiError("NOT_FOUND", `Account ${accountId} not found`);
    const device = await this.getDevice(account.deviceId);
    if (!device) throw new ApiError("NOT_FOUND", `Device ${account.deviceId} not found`);

    // 2. Insert command row with status = "queued".
    const { data: insertedRow, error: insertError } = await (
      supabase.from("commands") as unknown as {
        insert(values: {
          device_id: string;
          account_id: string;
          type: string;
          status: string;
        }): {
          select(): {
            single(): Promise<{
              data: CommandRow | null;
              error: import("@supabase/supabase-js").PostgrestError | null;
            }>;
          };
        };
      }
    )
      .insert({
        device_id: account.deviceId,
        account_id: accountId,
        type,
        status: "queued",
      })
      .select()
      .single();

    if (insertError) throw new ApiError("SEND_COMMAND", insertError.message);
    if (!insertedRow) throw new ApiError("SEND_COMMAND", "Failed to insert command");

    const commandId = insertedRow.id;

    // 3. Wait for terminal command state via sequential polling.
    const startTime = Date.now();
    let terminalRow: CommandRow | null = null;

    while (Date.now() - startTime < COMMAND_TIMEOUT_MS) {
      await new Promise((resolve) => setTimeout(resolve, COMMAND_POLL_INTERVAL_MS));

      const { data: cmdRow, error: pollError } = (await supabase
        .from("commands")
        .select("*")
        .eq("id", commandId)
        .maybeSingle()) as {
          data: CommandRow | null;
          error: import("@supabase/supabase-js").PostgrestError | null;
        };

      if (pollError) {
        throw new ApiError("FETCH_COMMAND", pollError.message);
      }

      if (!cmdRow) {
        throw new ApiError("NOT_FOUND", `Command ${commandId} not found`);
      }

      const status = cmdRow.status;
      if (status === "success" || status === "failed" || status === "expired") {
        terminalRow = cmdRow;
        break;
      }

      if (status === "queued" || status === "running") {
        continue;
      }

      throw new ApiError("UNSUPPORTED_STATUS", `Unsupported command status: ${status}`);
    }

    // 4. Web timeout: command is still non-terminal. Do NOT mutate or delete the DB row.
    if (!terminalRow) {
      throw new ApiError(
        "COMMAND_TIMEOUT",
        `Command ${type} timed out waiting for execution. The command is still pending and may execute later.`
      );
    }

    // 5. Fetch fresh Account & Device post-command.
    const freshAccount = await this.getAccount(accountId);
    if (!freshAccount) throw new ApiError("NOT_FOUND", `Account ${accountId} not found after command execution`);
    const freshDevice = await this.getDevice(freshAccount.deviceId);
    if (!freshDevice) throw new ApiError("NOT_FOUND", `Device ${freshAccount.deviceId} not found after command execution`);

    const command = mapCommand(terminalRow);
    const result: CommandResult = {
      command,
      account: freshAccount,
      device: freshDevice,
    };

    // 6. Terminal status branches:
    if (terminalRow.status === "success") {
      return result;
    }

    if (terminalRow.status === "failed") {
      const failureMessage =
        command.message ?? `${type} failed on ${freshDevice.name}`;
      throw new CommandFailedError(failureMessage, result);
    }

    if (terminalRow.status === "expired") {
      const expiredMessage =
        command.message ?? `Command ${type} expired before execution on ${freshDevice.name}`;
      throw new CommandFailedError(expiredMessage, result);
    }

    throw new ApiError("UNSUPPORTED_STATUS", `Unsupported command status: ${terminalRow.status}`);
  }

  async detectSpots(accountId: string): Promise<Command> {
    if (!accountId || typeof accountId !== "string" || accountId.trim().length === 0) {
      throw new ApiError("INVALID_ACCOUNT_INPUT", "Account ID is required");
    }

    // 1. Resolve target account to obtain canonical deviceId
    const account = await this.getAccount(accountId);
    if (!account) {
      throw new ApiError("NOT_FOUND", `Account ${accountId} not found`);
    }

    // 2. Validate owning device
    const device = await this.getDevice(account.deviceId);
    if (!device) {
      throw new ApiError("NOT_FOUND", `Device ${account.deviceId} not found`);
    }

    // 3. Insert command row with type = 'detect-spots' and status = 'queued'
    const { data: insertedRow, error: insertError } = await (
      supabase.from("commands") as unknown as {
        insert(values: {
          device_id: string;
          account_id: string;
          type: string;
          status: string;
        }): {
          select(): {
            single(): Promise<{
              data: CommandRow | null;
              error: import("@supabase/supabase-js").PostgrestError | null;
            }>;
          };
        };
      }
    )
      .insert({
        device_id: account.deviceId,
        account_id: accountId,
        type: "detect-spots",
        status: "queued",
      })
      .select()
      .single();

    if (insertError) throw new ApiError("SEND_COMMAND", insertError.message);
    if (!insertedRow) throw new ApiError("SEND_COMMAND", "Failed to insert detect-spots command");

    // 4. Return inserted Command immediately without waiting for execution
    return mapCommand(insertedRow);
  }

  // ── viewer ────────────────────────────────────────────────────────────────

  async getViewerSession(deviceId: string): Promise<ViewerSession | null> {
    const { data } = await supabase
      .from("devices")
      .select("id, viewer_url, viewer_expires_at")
      .eq("id", deviceId)
      .maybeSingle() as { data: { id: string; viewer_url: string | null; viewer_expires_at: string | null } | null; error: unknown };
    if (!data?.viewer_url) return null;

    // Validate lease has not expired
    const expiresAt = data.viewer_expires_at ? new Date(data.viewer_expires_at).getTime() : Infinity;
    if (expiresAt <= Date.now()) {
      return null;
    }

    const url = sanitizeViewerUrl(data.viewer_url);

    return {
      id: `viewer-${deviceId}`,
      deviceId,
      url,
      transport: "novnc" as const,
      state: "connected" as const,
      createdAt: Date.now(),
      reason: null,
    };
  }

  async connectViewer(deviceId: string): Promise<ViewerSession> {
    console.log("[viewer] request open-viewer start, deviceId:", deviceId);

    // 1. Check if an active, unexpired viewer session already exists
    const active = await this.getViewerSession(deviceId);
    if (active) {
      console.log("[viewer] active session already available:", active.url);
      return active;
    }

    // 2. Insert open-viewer command into commands table
    const { error: cmdError } = await supabase.from("commands").insert({
      device_id: deviceId,
      type: "open-viewer",
      status: "queued",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    if (cmdError) {
      console.error("[viewer] failed to insert open-viewer command:", cmdError);
      throw new ApiError("SEND_COMMAND", cmdError.message);
    }

    console.log("[viewer] open-viewer command created, waiting for agent to populate viewer_url...");

    // 3. Bounded polling for agent to populate devices.viewer_url (up to 15s)
    const pollIntervalMs = 1000;
    const maxAttempts = 15;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      const session = await this.getViewerSession(deviceId);
      if (session?.url) {
        console.log("[viewer] viewer_url received from agent:", session.url);
        return session;
      }
    }

    console.error("[viewer] timed out waiting for viewer_url from agent");
    throw new ApiError("TIMEOUT", "Viewer tunnel timed out waiting for agent");
  }

  async disconnectViewer(deviceId: string): Promise<ViewerSession> {
    console.log("[viewer] request close-viewer start, deviceId:", deviceId);
    const { error: cmdError } = await supabase.from("commands").insert({
      device_id: deviceId,
      type: "close-viewer",
      status: "queued",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    if (cmdError) {
      console.error("[viewer] failed to insert close-viewer command:", cmdError);
      throw new ApiError("SEND_COMMAND", cmdError.message);
    }

    return {
      id: `viewer-${deviceId}`,
      deviceId,
      url: null,
      transport: "novnc" as const,
      state: "closed" as const,
      createdAt: Date.now(),
      reason: null,
    };
  }

  // ── realtime ──────────────────────────────────────────────────────────────

  onUpdate(listener: UpdateListener): () => void {
    const channel = supabase
      .channel("zeus-realtime")
      // devices → device metrics, status, viewer_url
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "devices" },
        (payload) => {
          const row = payload.new as DeviceRow;
          if (!row?.id) return;
          listener({ device: mapDevice(row) });
        }
      )
      // accounts → config, desired_state, or DELETE
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "accounts" },
        async (payload) => {
          if (payload.eventType === "DELETE") {
            const oldRow = payload.old as { id?: unknown };
            const deletedId = typeof oldRow?.id === "string" ? oldRow.id : undefined;
            if (deletedId && deletedId.trim().length > 0) {
              listener({ deletedAccountId: deletedId });
            }
            return;
          }

          const row = payload.new as AccountRow;
          if (!row?.id) return;
          // Fetch runtime để có process_state đi kèm.
          const { data: rt } = await supabase
            .from("account_runtime")
            .select("*")
            .eq("account_id", row.id)
            .maybeSingle();
          listener({ account: mapAccount(row, rt) });
        }
      )
      // account_runtime → telemetry (high churn, separate table)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "account_runtime" },
        async (payload) => {
          const rt = payload.new as RuntimeRow;
          if (!rt?.account_id) return;
          const { data: acc } = await supabase
            .from("accounts")
            .select("*")
            .eq("id", rt.account_id)
            .maybeSingle();
          if (acc) listener({ account: mapAccount(acc, rt) });
        }
      )
      // commands → status update cho command đang chờ
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "commands" },
        async (payload) => {
          const cmd = payload.new as Database["public"]["Tables"]["commands"]["Row"];
          // Command update → refresh account để UI thấy trạng thái mới.
          if (cmd.account_id) {
            const { data: acc } = await supabase
              .from("accounts")
              .select("*, account_runtime(*)")
              .eq("id", cmd.account_id)
              .maybeSingle();
            if (acc) {
              const { account_runtime: rt, ...accRow } = acc as AccountRow & {
                account_runtime: RuntimeRow | null;
              };
              listener({ account: mapAccount(accRow, rt) });
            }
          }
        }
      )
      .subscribe();

    // Trả về unsubscribe để component cleanup khi unmount.
    return () => {
      void supabase.removeChannel(channel);
    };
  }

  // ── farm spots ─────────────────────────────────────────────────────────────

  listFarmSpots(mapId?: number): Promise<FarmSpot[]> {
    return listFarmSpots(mapId);
  }

  getFarmSpot(id: string): Promise<FarmSpot | null> {
    return getFarmSpot(id);
  }

  createFarmSpot(input: CreateFarmSpotInput): Promise<FarmSpot> {
    return createFarmSpot(input);
  }

  updateFarmSpot(id: string, input: UpdateFarmSpotInput): Promise<FarmSpot> {
    return updateFarmSpot(id, input);
  }

  deleteFarmSpot(id: string): Promise<string> {
    return deleteFarmSpot(id);
  }

  async startEnhancementQueue(params: { accountId: string; items: QueueItemSubmissionPayload[] }): Promise<EnhancementQueueJob> {
    const { data: sessionData, error: authErr } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (authErr || !user) {
      throw new ApiError("UNAUTHENTICATED", "Chưa đăng nhập");
    }
    return executeStartQueueFlow(supabase, params, { userId: user.id });
  }

  async pauseEnhancementQueue(jobId: string): Promise<EnhancementQueueJob> {
    const { data: sessionData, error: authErr } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (authErr || !user) {
      throw new ApiError("UNAUTHENTICATED", "Chưa đăng nhập");
    }
    return executePauseQueueFlow(supabase, jobId, user.id);
  }

  async cancelEnhancementQueue(jobId: string): Promise<EnhancementQueueJob> {
    const { data: sessionData, error: authErr } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (authErr || !user) {
      throw new ApiError("UNAUTHENTICATED", "Chưa đăng nhập");
    }
    return executeCancelQueueFlow(supabase, jobId, user.id);
  }

  async getActiveEnhancementQueue(accountId: string): Promise<EnhancementQueueJob | null> {
    const { data, error } = await supabase
      .from("enhancement_queue_jobs")
      .select("*")
      .eq("account_id", accountId)
      .in("status", [
        "QUEUED",
        "RUNNING",
        "PAUSING",
        "PAUSED",
        "MANUAL_REVIEW_REQUIRED",
      ])
      .maybeSingle();

    if (error || !data) return null;
    return mapQueueJobRow(data);
  }

  async getActiveQueueWithItems(accountId: string): Promise<AuthoritativeQueueWithItems | null> {
    return fetchActiveQueueWithItems(supabase, accountId);
  }

  async getRecentQueueHistory(accountId: string, limit = 5): Promise<AuthoritativeQueueWithItems[]> {
    return fetchRecentQueueHistory(supabase, accountId, limit);
  }

  subscribeQueueUpdates(accountId: string, onUpdate: () => void): () => void {
    if (!accountId) return () => {};
    const channelName = `eq_jobs_${accountId}_${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "enhancement_queue_jobs",
          filter: `account_id=eq.${accountId}`,
        },
        () => {
          onUpdate();
        },
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          onUpdate();
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }
}

// ── standalone farm spot service functions ───────────────────────────────────

export async function listFarmSpots(mapId?: number): Promise<FarmSpot[]> {
  let q = supabase
    .from("farm_spots")
    .select("*")
    .order("map_id", { ascending: true })
    .order("name", { ascending: true });

  if (mapId !== undefined && mapId >= 0) {
    q = q.eq("map_id", mapId);
  }

  const { data, error } = await q;
  if (error) {
    throw new ApiError("FETCH_FARM_SPOTS", error.message);
  }
  return (data ?? []).map(mapFarmSpot);
}

export async function getFarmSpot(id: string): Promise<FarmSpot | null> {
  if (!id || typeof id !== "string" || id.trim().length === 0) {
    throw new ApiError("INVALID_INPUT", "Spot ID is required");
  }
  const { data, error } = await supabase
    .from("farm_spots")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new ApiError("FETCH_FARM_SPOT", error.message);
  }
  return data ? mapFarmSpot(data) : null;
}

export async function createFarmSpot(input: CreateFarmSpotInput): Promise<FarmSpot> {
  const { data: sessionData, error: authError } = await supabase.auth.getSession();
  if (authError) {
    throw new ApiError("AUTH_ERROR", authError.message);
  }
  const user = sessionData.session?.user;
  if (!user) {
    throw new ApiError("UNAUTHENTICATED", "Chưa đăng nhập");
  }

  const insertPayload: Database["public"]["Tables"]["farm_spots"]["Insert"] = {
    user_id: user.id,
    name: input.name,
    map_id: input.mapId,
    x: input.x,
    y: input.y,
    captured_zone: input.capturedZone ?? -1,
    source: input.source ?? "manual",
  };

  const { data, error } = await supabase
    .from("farm_spots")
    .insert(insertPayload)
    .select("*")
    .single();

  if (error) {
    throw new ApiError("CREATE_FARM_SPOT", error.message);
  }
  if (!data) {
    throw new ApiError("CREATE_FARM_SPOT", "Không thể tạo điểm đánh");
  }
  return mapFarmSpot(data);
}

export async function updateFarmSpot(
  id: string,
  input: UpdateFarmSpotInput,
): Promise<FarmSpot> {
  if (!id || typeof id !== "string" || id.trim().length === 0) {
    throw new ApiError("INVALID_INPUT", "Spot ID is required");
  }

  const updatePayload: Database["public"]["Tables"]["farm_spots"]["Update"] = {};
  if (input.name !== undefined) updatePayload.name = input.name;
  if (input.mapId !== undefined) updatePayload.map_id = input.mapId;
  if (input.x !== undefined) updatePayload.x = input.x;
  if (input.y !== undefined) updatePayload.y = input.y;
  if (input.capturedZone !== undefined) updatePayload.captured_zone = input.capturedZone;

  const { data, error } = await supabase
    .from("farm_spots")
    .update(updatePayload)
    .eq("id", id)
    .select("*")
    .single();

  if (error) {
    throw new ApiError("UPDATE_FARM_SPOT", error.message);
  }
  if (!data) {
    throw new ApiError("NOT_FOUND", `Farm spot ${id} not found after update`);
  }
  return mapFarmSpot(data);
}

export async function deleteFarmSpot(id: string): Promise<string> {
  if (!id || typeof id !== "string" || id.trim().length === 0) {
    throw new ApiError("INVALID_INPUT", "Spot ID is required");
  }

  const { error } = await supabase
    .from("farm_spots")
    .delete()
    .eq("id", id);

  if (error) {
    throw new ApiError("DELETE_FARM_SPOT", error.message);
  }
  return id;
}

export const farmSpotsApi = {
  list: listFarmSpots,
  get: getFarmSpot,
  create: createFarmSpot,
  update: updateFarmSpot,
  delete: deleteFarmSpot,
};

export const supabaseApi: SupabaseApi = new SupabaseApi();
