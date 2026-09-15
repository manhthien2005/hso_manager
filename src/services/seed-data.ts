import { defaultAccountConfig } from "@/lib/config-schema";
import type { Account, Device, User } from "@/lib/types";

/**
 * Seed dataset for the mock phase.
 * Shape mirrors the planned Supabase `devices` / `accounts` tables so the same
 * rows can be inserted later without touching the UI.
 */

const MINUTE = 60_000;
/** 18h 31m, matching the dashboard spec. */
const UPTIME_18H31M = 18 * 3600 + 31 * 60;

export const SEED_USER: User = {
  id: "usr_01",
  email: "operator@zeus.cloud",
  username: "zeus",
  displayName: "Operator",
};

/** Accepted mock credentials. Any other combination is rejected by the API. */
export const SEED_CREDENTIALS = { username: "zeus", password: "zeus1234" };

const DEVICE_ONLINE: Device = {
  id: "dev_01",
  deviceId: "zk-sg-knight-01-a93f",
  userId: "usr_01",
  name: "SG-KNIGHT-01",
  region: "ap-southeast-1 (Singapore)",
  status: "online",
  agentVersion: "0.4.2",
  runtimeVersion: "knight-node 1.9.0",
  lastSeen: Date.now() - 12_000,
  viewerAvailable: true,
  metrics: {
    cpu: 12,
    ramUsedMb: 248,
    ramTotalMb: 1024,
    uptimeSeconds: UPTIME_18H31M,
  },
  jar_ctl_version: 13,
  viewer_url: "http://localhost:6080",
};

const DEVICE_OFFLINE: Device = {
  id: "dev_02",
  deviceId: "zk-sg-knight-02-77c1",
  userId: "usr_01",
  name: "SG-KNIGHT-02",
  region: "ap-southeast-1 (Singapore)",
  status: "offline",
  agentVersion: "0.4.2",
  runtimeVersion: "knight-node 1.8.4",
  lastSeen: Date.now() - 12 * MINUTE,
  viewerAvailable: false,
  metrics: { cpu: 0, ramUsedMb: 0, ramTotalMb: 2048, uptimeSeconds: 0 },
  jar_ctl_version: null,
  viewer_url: null,
};

export const SEED_DEVICES: Device[] = [DEVICE_ONLINE, DEVICE_OFFLINE];

function account(
  id: string,
  device: Device,
  label: string,
  status: Account["status"],
  characterName: string,
  serverId: number,
  configOverrides: Partial<Account["config"]> = {},
): Account {
  const live = status === "running" || status === "restarting";
  return {
    id,
    deviceId: device.deviceId,
    label,
    status,
    characterName: live ? characterName : null,
    serverId: live ? serverId : null,
    ramMb: live ? 40 + serverId * 3 : null,
    pid: live ? 100 + Number(id.slice(-2)) : null,
    config: {
      ...defaultAccountConfig(`${device.name.toLowerCase()}_acc${id.slice(-2)}`),
      characterName,
      serverId,
      ...configOverrides,
    },
    control: null,
    control_version: null,
    config_status: null,
    snapshot: null,
  };
}

export const SEED_ACCOUNTS: Account[] = [
  account("acc_01", DEVICE_ONLINE, "Account 01", "running", "KnightABC", 3, {
    memoryLimitMb: 512,
  }),
  account("acc_02", DEVICE_ONLINE, "Account 02", "running", "PaladinVN", 3, {
    memoryLimitMb: 512,
    automation: {
      autoLogin: true,
      autoPickServer: true,
      startupDelaySeconds: 25,
      restartEveryMinutes: 240,
      followSchedule: true,
      activeFrom: "08:00",
      activeTo: "23:30",
    },
  }),
  account("acc_03", DEVICE_ONLINE, "Account 03", "starting", "RogueSG", 4),
  account("acc_04", DEVICE_ONLINE, "Account 04", "error", "MageTH", 4, {
    additionalArgs: "-Xmx768m",
  }),
  account("acc_05", DEVICE_OFFLINE, "Account 05", "offline", "BerserkID", 1),
  account("acc_06", DEVICE_OFFLINE, "Account 06", "stopped", "ArcherMY", 2, {
    autoStart: false,
    autoRestart: false,
  }),
];
