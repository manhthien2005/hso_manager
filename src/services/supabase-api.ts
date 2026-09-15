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
 * - No polling: `onUpdate` drives từ realtime, không có setInterval.
 *
 * ## Mapping DB → frontend types
 *
 * DB schema (snake_case) ↔ frontend types (camelCase):
 *   devices.status         → Device.status (online/offline/degraded)
 *   account_runtime.process_state → Account.status
 *   devices.jar_ctl_version → Device.jar_ctl_version
 */

import { supabase } from "@/lib/supabase";
import type {
  Account,
  AccountConfig,
  Device,
  DeviceMetrics,
  User,
  ViewerSession,
} from "@/lib/types";
import type {
  ZeusApi,
  LoginCredentials,
  SendCommandInput,
  CommandResult,
  UpdateListener,
  Update,
} from "@/services/api";
import { ApiError } from "@/services/api";
import type { Database } from "@/lib/database.types";

type DeviceRow = Database["public"]["Tables"]["devices"]["Row"];
type AccountRow = Database["public"]["Tables"]["accounts"]["Row"];
type RuntimeRow = Database["public"]["Tables"]["account_runtime"]["Row"];

// ── mappers ──────────────────────────────────────────────────────────────────

function mapDevice(
  row: DeviceRow,
  runtime?: Pick<RuntimeRow, "cpu_pct" | "ram_mb"> | null
): Device {
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
    viewer_url: row.viewer_url,
  };
}

function mapAccount(acc: AccountRow, rt?: RuntimeRow | null): Account {
  const processState = rt?.process_state ?? "stopped";
  const status: import("@/lib/types").AccountStatus =
    processState === "running"
      ? "running"
      : processState === "starting"
        ? "starting"
        : processState === "crashed"
          ? "error"
          : "stopped";

  const snap = rt?.snapshot as Record<string, unknown> | null | undefined;
  const charName = snap?.["ch"] as string | null | undefined;
  const serverId = snap?.["sv"] as number | null | undefined;

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
    characterName: charName ?? null,
    serverId: serverId ?? null,
    ramMb: rt?.ram_mb ?? null,
    pid: rt?.pid ?? null,
    config,
    control: (acc.control ?? {}) as Record<string, unknown>,
    control_version: acc.control_version,
    config_status: rt?.config_status ?? null,
    snapshot: (rt?.snapshot as import("@/lib/types").PlayerSnapshot | null) ?? null,
  };
}

// ── implementation ───────────────────────────────────────────────────────────

class SupabaseApi implements ZeusApi {
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

  async updateAccountConfig(
    accountId: string,
    config: AccountConfig
  ): Promise<Account> {
    // config_version bump signals the agent that new config needs applying.
    const { data: existing } = await supabase
      .from("accounts")
      .select("config_version")
      .eq("id", accountId)
      .single() as { data: { config_version: number } | null };

    const nextVersion = (existing?.config_version ?? 0) + 1;

    const updatePayload = {
      control: config as unknown as Record<string, unknown>,
      config_version: nextVersion,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await (supabase
      .from("accounts") as unknown as {
        update(v: typeof updatePayload): {
          eq(col: string, val: string): {
            select(q: string): { single(): Promise<{ data: (AccountRow & { account_runtime: RuntimeRow | null }) | null; error: import("@supabase/supabase-js").PostgrestError | null }> }
          }
        }
      })
      .update(updatePayload)
      .eq("id", accountId)
      .select("*, account_runtime(*)")
      .single();



    if (error) throw new ApiError("UPDATE_CONFIG", error.message);
    const { account_runtime: rt, ...acc } = data!;
    return mapAccount(acc, rt);
  }

  // ── commands ──────────────────────────────────────────────────────────────

  async sendCommand({ accountId, type }: SendCommandInput): Promise<CommandResult> {
    // Get account + device first.
    const account = await this.getAccount(accountId);
    if (!account) throw new ApiError("NOT_FOUND", `Account ${accountId} not found`);
    const device = await this.getDevice(account.deviceId);
    if (!device) throw new ApiError("NOT_FOUND", `Device ${account.deviceId} not found`);

    // Insert command row.
    const { data, error } = await supabase
      .from("commands")
      .insert({
        device_id: account.deviceId,
        account_id: accountId,
        type,
        status: "queued",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
      .select()
      .single() as { data: Database["public"]["Tables"]["commands"]["Row"] | null; error: import("@supabase/supabase-js").PostgrestError | null };

    if (error) throw new ApiError("SEND_COMMAND", error.message);
    const row = data!;

    return {
      command: {
        id: row.id,
        type: row.type as import("@/lib/types").CommandType,
        status: row.status as import("@/lib/types").CommandStatus,
        createdAt: new Date(row.created_at).getTime(),
        finishedAt: row.finished_at ? new Date(row.finished_at).getTime() : null,
        message: row.message ?? null,
        accountId: row.account_id ?? accountId,
        deviceId: row.device_id,
      },
      account,
      device,
    };
  }

  // ── viewer ────────────────────────────────────────────────────────────────

  async getViewerSession(deviceId: string): Promise<ViewerSession | null> {
    const { data } = await supabase
      .from("devices")
      .select("id, viewer_url, viewer_expires_at")
      .eq("id", deviceId)
      .maybeSingle() as { data: { id: string; viewer_url: string | null; viewer_expires_at: string | null } | null; error: unknown };
    if (!data?.viewer_url) return null;
    return {
      id: `viewer-${deviceId}`,
      deviceId,
      url: data.viewer_url,
      transport: "novnc" as const,
      state: "connected" as const,
      createdAt: Date.now(),
      reason: null,
    };
  }

  async connectViewer(deviceId: string): Promise<ViewerSession> {
    await supabase.from("commands").insert({
      device_id: deviceId,
      type: "open-viewer",
      status: "queued",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    const session = await this.getViewerSession(deviceId);
    return session ?? {
      id: `viewer-${deviceId}`,
      deviceId,
      url: null,
      transport: "novnc" as const,
      state: "connecting" as const,
      createdAt: Date.now(),
      reason: "Command sent, waiting for agent",
    };
  }

  async disconnectViewer(deviceId: string): Promise<ViewerSession> {
    await supabase.from("commands").insert({
      device_id: deviceId,
      type: "close-viewer",
      status: "queued",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
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
      // accounts → config, desired_state
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "accounts" },
        async (payload) => {
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
}

export const supabaseApi: ZeusApi = new SupabaseApi();
