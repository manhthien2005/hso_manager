import type {
  Account,
  AccountControlUpdate,
  Command,
  CommandType,
  CreateAccountInput,
  CreateFarmSpotInput,
  Device,
  FarmSpot,
  EnhancementQueueJob,
  UpdateAccountInput,
  UpdateFarmSpotInput,
  User,
  ViewerSession,
} from "@/lib/types";
import type { QueueItemSubmissionPayload } from "@/lib/queue";
import type { AuthoritativeQueueWithItems } from "@/lib/queue-progress";
import { mockApi } from "@/services/mock-api";
import { supabaseApi } from "@/services/supabase-api";

export type { CreateAccountInput, UpdateAccountInput };

/**
 * Data-access contract for the whole UI.
 *
 * The mock phase ships `mockApi`. Swapping to Supabase means writing
 * `supabase-api.ts` that satisfies `ZeusApi` and changing the single export at
 * the bottom of this file — no component import changes.
 *
 * `onUpdate` is the realtime seam: the mock drives it from local timers,
 * Supabase will drive it from a postgres_changes channel.
 */
export interface ZeusApi {
  getSession(): Promise<User | null>;
  login(credentials: LoginCredentials): Promise<User>;
  logout(): Promise<void>;

  getDevices(): Promise<Device[]>;
  getDevice(deviceId: string): Promise<Device | null>;
  refreshDevice(deviceId: string): Promise<Device>;

  getAccounts(deviceId?: string): Promise<Account[]>;
  getAccount(accountId: string): Promise<Account | null>;
  createAccount(input: CreateAccountInput): Promise<Account>;
  updateAccount(input: UpdateAccountInput): Promise<Account>;
  updateAccountConfig(
    accountId: string,
    input: AccountControlUpdate,
  ): Promise<Account>;
  deleteAccount(
    accountId: string,
    stopCommandId: string,
  ): Promise<string>;

  sendCommand(input: SendCommandInput): Promise<CommandResult>;
  detectSpots(accountId: string): Promise<Command>;

  getViewerSession(deviceId: string): Promise<ViewerSession | null>;
  connectViewer(deviceId: string): Promise<ViewerSession>;
  disconnectViewer(deviceId: string): Promise<ViewerSession>;

  /** Subscribe to backend-driven state changes. Returns the unsubscribe fn. */
  onUpdate(listener: UpdateListener): () => void;

  listFarmSpots?(mapId?: number): Promise<FarmSpot[]>;
  getFarmSpot?(id: string): Promise<FarmSpot | null>;
  createFarmSpot?(input: CreateFarmSpotInput): Promise<FarmSpot>;
  updateFarmSpot?(id: string, input: UpdateFarmSpotInput): Promise<FarmSpot>;
  deleteFarmSpot?(id: string): Promise<string>;

  startEnhancementQueue?(params: { accountId: string; items: QueueItemSubmissionPayload[] }): Promise<EnhancementQueueJob>;
  pauseEnhancementQueue?(jobId: string): Promise<EnhancementQueueJob>;
  cancelEnhancementQueue?(jobId: string): Promise<EnhancementQueueJob>;
  getActiveEnhancementQueue?(accountId: string): Promise<EnhancementQueueJob | null>;
  getActiveQueueWithItems?(accountId: string): Promise<AuthoritativeQueueWithItems | null>;
  getRecentQueueHistory?(accountId: string, limit?: number): Promise<AuthoritativeQueueWithItems[]>;
  subscribeQueueUpdates?(accountId: string, onUpdate: () => void): () => void;
}

export interface FarmSpotApiMethods {
  listFarmSpots(mapId?: number): Promise<FarmSpot[]>;
  getFarmSpot(id: string): Promise<FarmSpot | null>;
  createFarmSpot(input: CreateFarmSpotInput): Promise<FarmSpot>;
  updateFarmSpot(id: string, input: UpdateFarmSpotInput): Promise<FarmSpot>;
  deleteFarmSpot(id: string): Promise<string>;
}

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface SendCommandInput {
  accountId: string;
  type: CommandType;
}

export interface CommandResult {
  command: Command;
  account: Account;
  device: Device;
}

export interface Update {
  device?: Device;
  account?: Account;
  deletedAccountId?: string;
}

export type UpdateListener = (update: Update) => void;

/** Raised for every non-success path so the UI can toast the real reason. */
export class ApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.code = code;
  }
}

/** Command reached the agent and came back failed; carries the final state. */
export class CommandFailedError extends ApiError {
  readonly result: CommandResult;

  constructor(message: string, result: CommandResult) {
    super("COMMAND_FAILED", message);
    this.name = "CommandFailedError";
    this.result = result;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : "Lỗi không xác định";
}

const mockFarmSpotsFallback: FarmSpotApiMethods = {
  async listFarmSpots(): Promise<FarmSpot[]> {
    return [];
  },
  async getFarmSpot(): Promise<FarmSpot | null> {
    return null;
  },
  async createFarmSpot(input: CreateFarmSpotInput): Promise<FarmSpot> {
    return {
      id: `mock-spot-${Date.now()}`,
      userId: "mock-user",
      name: input.name,
      mapId: input.mapId,
      x: input.x,
      y: input.y,
      capturedZone: input.capturedZone ?? -1,
      source: input.source ?? "manual",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  },
  async updateFarmSpot(id: string, input: UpdateFarmSpotInput): Promise<FarmSpot> {
    return {
      id,
      userId: "mock-user",
      name: input.name ?? "mock-spot",
      mapId: input.mapId ?? 1,
      x: input.x ?? 0,
      y: input.y ?? 0,
      capturedZone: input.capturedZone ?? -1,
      source: "manual",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  },
  async deleteFarmSpot(id: string): Promise<string> {
    return id;
  },
};

export type ZeusApiClient = ZeusApi & FarmSpotApiMethods;

/** The only place the implementation is chosen. */
// Switch: mockApi ↔ supabaseApi — no component imports change.
export const api: ZeusApiClient = new Proxy({} as ZeusApiClient, {
  get(_target, prop) {
    const target = process.env.NEXT_PUBLIC_SUPABASE_URL
      ? supabaseApi
      : Object.assign(mockApi, mockFarmSpotsFallback);
    const value = (target as unknown as Record<string | symbol, unknown>)[prop];
    return typeof value === "function" ? value.bind(target) : value;
  },
});
