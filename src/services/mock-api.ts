import {
  ApiError,
  CommandFailedError,
  type CommandResult,
  type CreateAccountInput,
  type SendCommandInput,
  type Update,
  type UpdateAccountInput,
  type UpdateListener,
  type ZeusApi,
} from "@/services/api";
import {
  CONTROL_SCHEMA,
  defaultAccountConfig,
  defaultControlDraft,
  draftToControlRecord,
  validateDraft,
} from "@/lib/config-schema";
import {
  SEED_ACCOUNTS,
  SEED_CREDENTIALS,
  SEED_DEVICES,
  SEED_USER,
} from "@/services/seed-data";
import type {
  Account,
  AccountStatus,
  Command,
  CommandType,
  Device,
  ViewerSession,
} from "@/lib/types";
import { clampNumber } from "@/lib/format";

/**
 * In-memory implementation of `ZeusApi`.
 *
 * Behaviour the UI must be able to demo without a backend:
 *  - artificial latency so loading states are real
 *  - command lifecycle: queued -> starting -> running (with a failed case)
 *  - jittered metrics pushed through `onUpdate` (the realtime seam)
 *  - offline devices reject commands and the viewer
 *
 * Module state lives behind lazy getters so React StrictMode's double render
 * never resets it.
 */

const LATENCY = { min: 250, max: 650 };
const TICK_MS = 4000;
const SESSION_KEY = "zeus.session";

let state: MockState | null = null;

interface MockState {
  devices: Device[];
  accounts: Account[];
  commands: Command[];
  listeners: Set<UpdateListener>;
  viewer: Map<string, ViewerSession>;
  /** `window.setInterval` handle; null when the simulation is idle. */
  tick: number | null;
}

function load(): MockState {
  if (state === null) {
    state = {
      devices: structuredClone(SEED_DEVICES),
      accounts: structuredClone(SEED_ACCOUNTS),
      commands: [],
      viewer: new Map(),
      listeners: new Set(),
      tick: null,
    };
  }
  return state;
}

function delay(): Promise<void> {
  const ms = LATENCY.min + Math.random() * (LATENCY.max - LATENCY.min);
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

function nextId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function emit(update: Update): void {
  for (const listener of load().listeners) listener(update);
}

function findDevice(deviceId: string): Device {
  const device = load().devices.find(
    (item) => item.deviceId === deviceId || item.id === deviceId,
  );
  if (!device) {
    throw new ApiError("DEVICE_NOT_FOUND", `Unknown device "${deviceId}"`);
  }
  return device;
}

function findAccount(accountId: string): Account {
  const account = load().accounts.find((item) => item.id === accountId);
  if (!account) {
    throw new ApiError("ACCOUNT_NOT_FOUND", `Unknown account "${accountId}"`);
  }
  return account;
}

function setAccount(accountId: string, patch: Partial<Account>): Account {
  const current = findAccount(accountId);
  const next: Account = { ...current, ...patch };
  load().accounts = load().accounts.map((item) =>
    item.id === accountId ? next : item,
  );
  emit({ account: next });
  return next;
}

function setDevice(deviceId: string, patch: Partial<Device>): Device {
  const current = findDevice(deviceId);
  const next: Device = { ...current, ...patch };
  load().devices = load().devices.map((item) =>
    item.id === current.id ? next : item,
  );
  emit({ device: next });
  return next;
}

function requireOnline(device: Device): void {
  if (device.status !== "online") {
    throw new ApiError(
      "DEVICE_OFFLINE",
      `${device.name} is offline — the agent cannot receive commands`,
    );
  }
}

function recordCommand(
  account: Account,
  type: CommandType,
  status: Command["status"],
  message: string | null,
): Command {
  const command: Command = {
    id: nextId("cmd"),
    accountId: account.id,
    deviceId: account.deviceId,
    type,
    status,
    createdAt: Date.now(),
    finishedAt: status === "queued" || status === "running" ? null : Date.now(),
    message,
  };
  load().commands.unshift(command);
  return command;
}

/** Status the account settles into once a command resolves. */
function targetStatus(type: CommandType): AccountStatus {
  switch (type) {
    case "start":
    case "restart":
      return "running";
    case "stop":
      return "stopped";
    case "apply-config":
    case "open-viewer":
    case "close-viewer":
    case "detect-spots":
      return "running";
  }
}

/** Transient status shown while the command is in flight. */
function pendingStatus(type: CommandType): AccountStatus {
  switch (type) {
    case "start":
      return "starting";
    case "restart":
      return "restarting";
    case "stop":
      return "stopped";
    case "apply-config":
    case "open-viewer":
    case "close-viewer":
    case "detect-spots":
      return "running";
  }
}

function applyCommandOutcome(
  account: Account,
  type: CommandType,
  failed: boolean,
): Account {
  if (failed) {
    return setAccount(account.id, {
      status: "error",
      pid: null,
      ramMb: null,
      characterName: null,
      serverId: null,
    });
  }
  const status = targetStatus(type);
  if (status === "stopped") {
    return setAccount(account.id, {
      status,
      pid: null,
      ramMb: null,
      characterName: null,
      serverId: null,
    });
  }
  return setAccount(account.id, {
    status,
    pid: account.pid ?? Math.floor(1000 + Math.random() * 8999),
    ramMb: account.ramMb ?? account.config.memoryLimitMb / 8,
    characterName: account.characterName ?? account.config.characterName,
    serverId: account.serverId ?? account.config.serverId,
  });
}

/**
 * Runs the full command flow the UI needs to demonstrate:
 * loading button -> fake latency -> transient status -> settle -> success/error.
 */
async function runCommand({ accountId, type }: SendCommandInput): Promise<CommandResult> {
  await delay();

  const account = findAccount(accountId);
  const device = findDevice(account.deviceId);
  requireOnline(device);

  if (type === "start" && account.status === "running") {
    throw new ApiError("ALREADY_RUNNING", `${account.label} is already running`);
  }

  setAccount(account.id, { status: pendingStatus(type) });

  // Second latency beat stands in for the agent picking the command up.
  await delay();

  // Deterministic-ish failure so error toasts are reachable in the demo:
  // an account already in `error` never recovers on the first retry.
  const failed = account.status === "error" && type !== "stop";
  const settled = applyCommandOutcome(account, type, failed);
  const command = recordCommand(
    settled,
    type,
    failed ? "failed" : "success",
    failed
      ? "Emulator exited with code 1 — check the account config"
      : `${type} completed on ${device.name}`,
  );
  if (failed) {
    throw new CommandFailedError(
      command.message ?? `${type} failed on ${device.name}`,
      { command, account: settled, device },
    );
  }
  return { command, account: settled, device };
}

async function runDetectSpots(accountId: string): Promise<Command> {
  await delay();
  const account = findAccount(accountId);
  const device = findDevice(account.deviceId);
  requireOnline(device);

  const command = recordCommand(account, "detect-spots", "queued", null);
  return structuredClone(command);
}

function jitter(value: number, span: number, min: number, max: number): number {
  const drift = (Math.random() - 0.5) * 2 * span;
  return clampNumber(Math.round(value + drift), min, max);
}

/** Local metrics simulation — stands in for Supabase Realtime heartbeats. */
/**
 * Local metrics simulation — stands in for Supabase Realtime heartbeats.
 * Re-reads each device inside the tick because `setDevice` swaps the array.
 */
function simulateTick(): void {
  const current = load();
  for (const device of [...current.devices]) {
    if (device.status !== "online") continue;
    const accounts = current.accounts.filter(
      (account) => account.deviceId === device.deviceId,
    );
    for (const account of accounts) {
      if (account.status !== "running" && account.status !== "restarting") {
        continue;
      }
      setAccount(account.id, {
        ramMb: jitter(account.ramMb ?? 48, 5, 24, account.config.memoryLimitMb),
      });
    }
    const usedMb = accounts.reduce(
      (total, account) => total + (account.ramMb ?? 0),
      80,
    );
    setDevice(device.id, {
      lastSeen: Date.now(),
      metrics: {
        cpu: jitter(device.metrics.cpu, 6, 3, 92),
        ramUsedMb: clampNumber(usedMb, 64, device.metrics.ramTotalMb),
        ramTotalMb: device.metrics.ramTotalMb,
        uptimeSeconds: device.metrics.uptimeSeconds + TICK_MS / 1000,
      },
    });
  }
}

function ensureTick(): void {
  const current = load();
  if (current.tick !== null) return;
  if (typeof window === "undefined") return;
  current.tick = window.setInterval(simulateTick, TICK_MS);
}

function stopTick(): void {
  const current = load();
  if (current.tick !== null) {
    window.clearInterval(current.tick);
    current.tick = null;
  }
}

function readSession(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(SESSION_KEY) === "1";
}

export const mockApi: ZeusApi = {
  async getSession() {
    if (!readSession()) return null;
    return structuredClone(SEED_USER);
  },

  async login({ username, password }) {
    await delay();
    if (
      username.trim().toLowerCase() !== SEED_CREDENTIALS.username ||
      password !== SEED_CREDENTIALS.password
    ) {
      throw new ApiError(
        "INVALID_CREDENTIALS",
        "Invalid username or password. Demo login: zeus / zeus1234",
      );
    }
    if (typeof window !== "undefined") {
      window.sessionStorage.setItem(SESSION_KEY, "1");
    }
    ensureTick();
    return structuredClone(SEED_USER);
  },

  async logout() {
    stopTick();
    if (typeof window !== "undefined") {
      window.sessionStorage.removeItem(SESSION_KEY);
    }
  },

  async getDevices() {
    await delay();
    ensureTick();
    return structuredClone(load().devices);
  },

  async getDevice(deviceId) {
    await delay();
    ensureTick();
    try {
      return structuredClone(findDevice(deviceId));
    } catch {
      return null;
    }
  },

  async refreshDevice(deviceId) {
    await delay();
    const device = findDevice(deviceId);
    if (device.status !== "online") {
      // Offline devices stay offline in the mock; surface a fresh heartbeat age.
      return structuredClone(device);
    }
    return structuredClone(
      setDevice(device.id, {
        lastSeen: Date.now(),
        metrics: {
          ...device.metrics,
          cpu: jitter(device.metrics.cpu, 8, 3, 92),
        },
      }),
    );
  },

  async getAccounts(deviceId) {
    await delay();
    ensureTick();
    const current = load();
    if (deviceId === undefined) return structuredClone(current.accounts);
    const device = current.devices.find(
      (item) => item.deviceId === deviceId || item.id === deviceId,
    );
    const scoped = current.accounts.filter(
      (account) => account.deviceId === device?.deviceId,
    );
    return structuredClone(scoped);
  },

  async getAccount(accountId) {
    await delay();
    ensureTick();
    const account = load().accounts.find((item) => item.id === accountId);
    return account ? structuredClone(account) : null;
  },

  async createAccount(input: CreateAccountInput) {
    await delay();
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

    const device = findDevice(input.deviceId);
    const ctlVersion = device.jar_ctl_version;
    if (ctlVersion === null || ctlVersion <= 0 || !CONTROL_SCHEMA[ctlVersion]) {
      throw new ApiError(
        "UNSUPPORTED_CTL_VERSION",
        `Device ${input.deviceId} has unsupported or missing CTL version (${ctlVersion ?? "null"})`,
      );
    }

    const draft = defaultControlDraft(ctlVersion);
    const errors = validateDraft(draft, ctlVersion);
    if (Object.keys(errors).length > 0) {
      throw new ApiError(
        "INVALID_CONTROL_DEFAULT",
        `Default control block is invalid for CTL version ${ctlVersion}`,
      );
    }
    const control = draftToControlRecord(draft, ctlVersion);

    const newAccount: Account = {
      id: nextId("acc"),
      deviceId: device.deviceId,
      label: input.label.trim(),
      status: "stopped",
      characterName: null,
      serverId: input.serverIndex,
      ramMb: null,
      pid: null,
      config: defaultAccountConfig(input.username),
      control,
      control_version: ctlVersion,
      config_status: null,
      snapshot: null,
    };

    load().accounts.push(newAccount);
    emit({ account: newAccount });
    return structuredClone(newAccount);
  },

  async updateAccount(input: UpdateAccountInput) {
    await delay();
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

    const current = findAccount(input.accountId);

    const patch: Partial<Account> = {
      label: input.label.trim(),
      serverId: input.serverIndex,
      config: {
        ...current.config,
        serverId: input.serverIndex,
      },
    };

    if (input.credentials !== undefined) {
      const { username, password } = input.credentials;
      if (!username || typeof username !== "string" || username.trim().length === 0) {
        throw new ApiError("INVALID_ACCOUNT_INPUT", "Username must not be empty");
      }
      if (!password || typeof password !== "string" || password.length === 0) {
        throw new ApiError("INVALID_ACCOUNT_INPUT", "Password must not be empty");
      }
      patch.config = {
        ...patch.config!,
        accountName: username,
      };
    }

    const updated = setAccount(input.accountId, patch);
    return structuredClone(updated);
  },

  async updateAccountConfig(accountId, input) {
    await delay();
    const account = findAccount(accountId);
    const device = findDevice(account.deviceId);
    requireOnline(device);

    const updated = setAccount(accountId, {
      control: input.control,
      control_version: input.controlVersion,
    });
    recordCommand(
      updated,
      "apply-config",
      "success",
      `Control v${input.controlVersion} saved for ${account.label}`,
    );
    return structuredClone(updated);
  },

  async deleteAccount(accountId: string, stopCommandId: string): Promise<string> {
    await delay();
    if (!accountId || typeof accountId !== "string" || accountId.trim().length === 0) {
      throw new ApiError("INVALID_ACCOUNT_INPUT", "Account ID is required");
    }
    if (!stopCommandId || typeof stopCommandId !== "string" || stopCommandId.trim().length === 0) {
      throw new ApiError("INVALID_STOP_COMMAND_INPUT", "Stop command ID is required");
    }

    const current = load();
    const account = current.accounts.find((a) => a.id === accountId);
    if (!account) {
      throw new ApiError("ACCOUNT_NOT_FOUND", `Account ${accountId} not found`);
    }

    // 1. Validate Stop command proof
    const cmd = current.commands.find((c) => c.id === stopCommandId);
    if (!cmd) {
      throw new ApiError("INVALID_STOP_PROOF", `Stop command ${stopCommandId} not found`);
    }
    if (cmd.accountId !== accountId) {
      throw new ApiError(
        "INVALID_STOP_PROOF",
        `Stop command ${stopCommandId} does not belong to account ${accountId}`,
      );
    }
    if (cmd.deviceId !== account.deviceId) {
      throw new ApiError(
        "INVALID_STOP_PROOF",
        `Stop command ${stopCommandId} does not belong to device ${account.deviceId}`,
      );
    }
    if (cmd.type !== "stop") {
      throw new ApiError(
        "INVALID_STOP_PROOF",
        `Command ${stopCommandId} is type "${cmd.type}", expected "stop"`,
      );
    }
    if (cmd.status !== "success") {
      throw new ApiError(
        "INVALID_STOP_PROOF",
        `Stop command ${stopCommandId} status is "${cmd.status}", expected "success"`,
      );
    }
    if (cmd.finishedAt === null || cmd.finishedAt === undefined) {
      throw new ApiError("INVALID_STOP_PROOF", `Stop command ${stopCommandId} has no finishedAt`);
    }

    const proofFinishedAt = cmd.finishedAt;

    // 2. Stale proof check: no start/restart command with createdAt > proofFinishedAt or finishedAt >= proofFinishedAt
    const staleCommand = current.commands.find(
      (c) =>
        c.accountId === accountId &&
        (c.type === "start" || c.type === "restart") &&
        (c.createdAt > proofFinishedAt ||
          (c.finishedAt !== null && c.finishedAt >= proofFinishedAt)),
    );
    if (staleCommand) {
      throw new ApiError(
        "STALE_STOP_PROOF",
        `Stop proof is stale: later or same-time start/restart command ${staleCommand.id} exists`,
      );
    }

    // 3. Active command check: no queued or running commands for account
    const activeCommand = current.commands.find(
      (c) => c.accountId === accountId && (c.status === "queued" || c.status === "running"),
    );
    if (activeCommand) {
      throw new ApiError(
        "ACTIVE_COMMANDS_EXIST",
        `Active command ${activeCommand.id} exists for account ${accountId}`,
      );
    }

    // 4. Account lifecycle state check (mock parity for desired_state = 'stopped')
    if (account.status !== "stopped") {
      throw new ApiError(
        "INVALID_ACCOUNT_STATE",
        `Account status is "${account.status}", expected "stopped"`,
      );
    }

    // 5. Cascade: remove account and account-specific commands
    current.accounts = current.accounts.filter((a) => a.id !== accountId);
    current.commands = current.commands.filter((c) => c.accountId !== accountId);

    emit({ deletedAccountId: accountId });
    return accountId;
  },

  sendCommand: runCommand,
  detectSpots: runDetectSpots,

  async getViewerSession(deviceId) {
    const device = findDevice(deviceId);
    return structuredClone(load().viewer.get(device.id) ?? null);
  },

  async connectViewer(deviceId) {
    await delay();
    const device = findDevice(deviceId);
    requireOnline(device);
    device.viewerAvailable = true;
    device.viewer_url = "http://localhost:6080/vnc.html";
    const session: ViewerSession = {
      id: nextId("vs"),
      deviceId: device.deviceId,
      url: device.viewer_url,
      transport: "mock",
      state: "connected",
      createdAt: Date.now(),
      reason: null,
    };
    load().viewer.set(device.id, session);
    return structuredClone(session);
  },

  async disconnectViewer(deviceId) {
    await delay();
    const device = findDevice(deviceId);
    const session = load().viewer.get(device.id);
    const closed: ViewerSession = session
      ? { ...session, state: "closed", reason: "Session closed by operator" }
      : {
          id: nextId("vs"),
          deviceId: device.deviceId,
          url: null,
          transport: "mock",
          state: "closed",
          createdAt: Date.now(),
          reason: "Session closed by operator",
        };
    load().viewer.set(device.id, closed);
    return structuredClone(closed);
  },

  onUpdate(listener) {
    const current = load();
    current.listeners.add(listener);
    ensureTick();
    return () => {
      current.listeners.delete(listener);
      if (current.listeners.size === 0) stopTick();
    };
  },
};
