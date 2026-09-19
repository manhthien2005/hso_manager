import type {
  Account,
  AccountControlUpdate,
  Command,
  CommandType,
  CreateAccountInput,
  Device,
  UpdateAccountInput,
  User,
  ViewerSession,
} from "@/lib/types";
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

  getViewerSession(deviceId: string): Promise<ViewerSession | null>;
  connectViewer(deviceId: string): Promise<ViewerSession>;
  disconnectViewer(deviceId: string): Promise<ViewerSession>;

  /** Subscribe to backend-driven state changes. Returns the unsubscribe fn. */
  onUpdate(listener: UpdateListener): () => void;
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
  return error instanceof Error ? error.message : "Unexpected error";
}

/** The only place the implementation is chosen. */
// Switch: mockApi ↔ supabaseApi — no component imports change.
export const api: ZeusApi = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? supabaseApi   // Supabase credentials present → use real backend
  : mockApi;      // Fallback for local dev without .env.local
