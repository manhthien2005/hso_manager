/**
 * Schema-driven config form — version-keyed against the jar wire contract.
 *
 * The key set is the authority:
 *   WIRE-CONTRACT.md §4.1 — 35 lines (including `v`).
 *   `accounts.control` stores 34 keys (all except `v`); `v` is in
 *   `accounts.control_version` and `devices.jar_ctl_version`.
 *
 * Adding a field = add one descriptor here. The config page version-gates
 * itself: if `device.jar_ctl_version` has no entry in CONTROL_SCHEMA it
 * renders a banner instead of a form, preventing stale-schema writes.
 *
 * Three new field types beyond the original set:
 *   "select"  — dropdown, uses `options: { value, label }[]`
 *   "flags"   — bit-string of fixed length; renders N toggles in a row
 *   "action"  — one-shot button (e.g. nav.detectSpots); value is 0/1
 */

import {
  validateAttackSpotSave,
  normalizeDraftForSave,
  updateLocationWithZoneReset,
} from "./attack-spot";
import { MOUNT_CATALOG } from "./mounts";

export { normalizeDraftForSave, updateLocationWithZoneReset };

// ── Value types ──────────────────────────────────────────────────────────────

export type ConfigValue = string | number | boolean;

// ── Path union — every key in the 34-key control block ──────────────────────

export type ConfigPath =
  | "atk.mode"
  | "atk.map"
  | "atk.zone"
  | "atk.x"
  | "atk.y"
  | "atk.radius"
  | "atk.hpOn"
  | "atk.hpPct"
  | "atk.mpOn"
  | "atk.mpPct"
  | "revive.mode"
  | "atk.buffs"
  | "atk.zoneMode"
  | "atk.zonePick"
  | "item.rank"
  | "item.mphp"
  | "item.gold"
  | "mount.on"
  | "mount.id"
  | "item.medalDialog"
  | "item.dropsOn"
  | "item.drops"
  | "nav.target"
  | "ui.ring"
  | "atk.farmOnArrival"
  | "nav.detectSpots"
  | "revive.delay"
  | "revive.on"
  | "enhance.on"
  | "enhance.maxLv"
  | "enhance.charm"
  | "dungeon.on"
  | "dungeon.max"
  | "dungeon.schedule";

export type ConfigDraft = Record<ConfigPath, ConfigValue>;
export type ConfigErrors = Partial<Record<ConfigPath, string>>;

// ── Field descriptor ─────────────────────────────────────────────────────────

export interface ConfigFieldBase {
  path: ConfigPath;
  label: string;
  help?: string;
  hidden?: boolean;
}

export interface ConfigFieldToggle extends ConfigFieldBase {
  type: "toggle";
}

export interface ConfigFieldNumber extends ConfigFieldBase {
  type: "number";
  min?: number;
  max?: number;
  suffix?: string;
}

export interface ConfigFieldSelect extends ConfigFieldBase {
  type: "select";
  options: Array<{ value: number; label: string }>;
}

/**
 * Fixed-length bit-string: e.g. "011" for atk.buffs (3 slots).
 * Each position is rendered as a named toggle.
 */
export interface ConfigFieldFlags extends ConfigFieldBase {
  type: "flags";
  /** Exactly this many characters, each '0'|'1'. */
  length: number;
  /** Label for each bit position (index 0 = leftmost). */
  bitLabels: string[];
}

/**
 * One-shot action: rendered as a button. Clicking sends value `1`; the agent
 * resets it to `0` after execution. The draft holds the button's "armed" state.
 */
export interface ConfigFieldAction extends ConfigFieldBase {
  type: "action";
  buttonLabel: string;
}

export interface ConfigFieldTravelMap extends ConfigFieldBase {
  type: "travel-map";
  min?: number;
  max?: number;
}

export interface ConfigFieldGameMap extends ConfigFieldBase {
  type: "game-map";
  min?: number;
  max?: number;
}

export type ConfigField =
  | ConfigFieldToggle
  | ConfigFieldNumber
  | ConfigFieldSelect
  | ConfigFieldFlags
  | ConfigFieldAction
  | ConfigFieldTravelMap
  | ConfigFieldGameMap;

export interface ConfigSection {
  id: string;
  title: string;
  description?: string;
  hidden?: boolean;
  fields: ConfigField[];
}

export const CONTROL_SCHEMA: Record<number, ConfigSection[]> = {
  13: [
    // ── Auto Farm ─────────────────────────────────────────────────────────
    {
      id: "auto_farm",
      title: "Auto Farm",
      description: "Chế độ tự đánh, vị trí bãi đánh, chính sách khu vực và nhặt vật phẩm.",
      fields: [
        {
          path: "atk.mode",
          label: "Attack Mode",
          type: "select",
          help: "Stand: attack in place. Move: follow mobs.",
          options: [
            { value: 0, label: "Off" },
            { value: 1, label: "Stand" },
            { value: 2, label: "Move" },
          ],
        },
        {
          path: "atk.radius",
          label: "Attack Radius",
          type: "number",
          min: 60,
          max: 240,
          suffix: "px",
          help: "World-pixel radius around the spot centre. Clamped 60–240.",
        },
        {
          path: "ui.ring",
          label: "Show Attack Ring",
          type: "toggle",
          help: "Draw the attack-radius overlay on screen. Local display only.",
        },
        {
          path: "atk.map",
          label: "Map ID",
          type: "game-map",
          min: 0,
          max: 255,
          help: "0 = no spot set.",
        },
        {
          path: "atk.zone",
          label: "Zone",
          type: "number",
          min: -1,
          max: 127,
          help: "-1 = no zone.",
        },
        {
          path: "atk.x",
          label: "X (world pixel)",
          type: "number",
          min: -1,
          max: 2147483647,
          help: "-1 = no spot.",
        },
        {
          path: "atk.y",
          label: "Y (world pixel)",
          type: "number",
          min: -1,
          max: 2147483647,
          help: "-1 = no spot.",
        },
        {
          path: "atk.zoneMode",
          label: "Zone Mode",
          type: "select",
          options: [
            { value: 0, label: "Keep (stay in current zone)" },
            { value: 1, label: "Emptiest (least players)" },
            { value: 2, label: "Pick (specific zone)" },
          ],
        },
        {
          path: "atk.zonePick",
          label: "Zone Pick",
          type: "number",
          min: 1,
          max: 99,
          help: "Zone number to use when Zone Mode is 'Pick'.",
        },
        {
          path: "item.rank",
          label: "Item Rank (threshold)",
          type: "select",
          help: 'Pick up this rank and above. "All" picks everything; "None" skips all items.',
          options: [
            { value: 0, label: "All (pick everything)" },
            { value: 1, label: "Blue and above" },
            { value: 2, label: "Yellow and above" },
            { value: 3, label: "Purple and above" },
            { value: 4, label: "Orange and above" },
            { value: 5, label: "None (skip all)" },
          ],
        },
        {
          path: "item.mphp",
          label: "MP/HP Potion Pickup",
          type: "select",
          options: [
            { value: 0, label: "All (HP and MP)" },
            { value: 1, label: "HP Only" },
            { value: 2, label: "MP Only" },
            { value: 3, label: "None" },
          ],
        },
        {
          path: "item.gold",
          label: "Gold Pickup",
          type: "select",
          options: [
            { value: 0, label: "Pick up gold" },
            { value: 1, label: "Skip gold" },
          ],
        },
        {
          path: "item.medalDialog",
          label: "Medal Dialog",
          type: "toggle",
          help: "Auto-dismiss the medal/reward dialog.",
        },
        {
          path: "item.dropsOn",
          label: "Drop Filter Active",
          type: "toggle",
          help: "Toggle the drop-close filter. Enabling changes what the character closes over.",
        },
        {
          path: "item.drops",
          label: "Drop Close Slots",
          type: "flags",
          length: 6,
          bitLabels: ["Slot 1", "Slot 2", "Slot 3", "Slot 4", "Slot 5", "Slot 6"],
          help: "Close (1) or open (0) each drop slot. Only active when Drop Filter is on.",
        },
      ],
    },

    // ── Combat ────────────────────────────────────────────────────────────
    {
      id: "combat",
      title: "Combat",
      description: "HP/MP potion thresholds and buff settings.",
      fields: [
        {
          path: "atk.hpOn",
          label: "HP Potion",
          type: "toggle",
          help: "Enable automatic HP potion use.",
        },
        {
          path: "atk.hpPct",
          label: "HP Threshold",
          type: "number",
          min: 1,
          max: 99,
          suffix: "%",
          help: "Drink HP potion when HP falls below this percentage.",
        },
        {
          path: "atk.mpOn",
          label: "MP Potion",
          type: "toggle",
          help: "Enable automatic MP potion use.",
        },
        {
          path: "atk.mpPct",
          label: "MP Threshold",
          type: "number",
          min: 1,
          max: 99,
          suffix: "%",
          help: "Drink MP potion when MP falls below this percentage.",
        },
        {
          path: "atk.buffs",
          label: "Buff Slots",
          type: "flags",
          length: 3,
          bitLabels: ["Slot 1", "Slot 2", "Slot 3"],
          help: "Enable each buff slot the character has learned.",
        },
      ],
    },

    // ── Travel ────────────────────────────────────────────────────────────
    {
      id: "travel",
      title: "Travel",
      description: "Navigation target map settings.",
      fields: [
        {
          path: "nav.target",
          label: "Nav Target Map",
          type: "travel-map",
          min: -1,
          max: 135,
          help: "Map ID to travel to. -1 = off. Agent clears this when destination is reached.",
        },
      ],
    },

    // ── Recovery ──────────────────────────────────────────────────────────
    {
      id: "recovery",
      title: "Recovery",
      description: "Revive and stuck recovery behaviour.",
      fields: [
        {
          path: "revive.on",
          label: "Auto Revive",
          type: "toggle",
          help: "Automatically revive after death.",
        },
        {
          path: "revive.mode",
          label: "Revive Mode",
          type: "select",
          help: 'How to revive. "Off" is controlled by Auto Revive toggle, not this field.',
          options: [
            { value: 1, label: "Revive in place" },
            { value: 2, label: "Return to village" },
          ],
        },
        {
          path: "revive.delay",
          label: "Revive Delay",
          type: "number",
          min: 0,
          max: 300,
          suffix: "s",
          help: "Seconds to wait on the ground before reviving.",
        },
      ],
    },

    // ── Mount ─────────────────────────────────────────────────────────────
    {
      id: "mount",
      title: "Mount",
      description: "Mount usage in the attack zone.",
      fields: [
        {
          path: "mount.on",
          label: "Use Mount",
          type: "toggle",
        },
        {
          path: "mount.id",
          label: "Mount ID",
          type: "select",
          help: "0 = any available mount.",
          options: MOUNT_CATALOG.map((m) => ({
            value: m.id,
            label: m.name,
          })),
        },
      ],
    },

    // ── Enhance ───────────────────────────────────────────────────────────
    {
      id: "enhance",
      title: "Enhance",
      description: "Automatic item enhancement (uses charm and gold).",
      fields: [
        {
          path: "enhance.on",
          label: "Auto Enhance",
          type: "toggle",
        },
        {
          path: "enhance.maxLv",
          label: "Max Enhance Level",
          type: "number",
          min: 1,
          max: 15,
          help: "Stop enhancing when this level is reached.",
        },
        {
          path: "enhance.charm",
          label: "Charm Type",
          type: "select",
          options: [
            { value: 0, label: "No charm" },
            { value: 1, label: "Charm 1" },
            { value: 2, label: "Charm 2" },
            { value: 3, label: "Charm 3" },
          ],
        },
      ],
    },

    // ── Dungeon ───────────────────────────────────────────────────────────
    {
      id: "dungeon",
      title: "Dungeon",
      description: "Automatic dungeon entry.",
      fields: [
        {
          path: "dungeon.on",
          label: "Auto Dungeon",
          type: "toggle",
        },
        {
          path: "dungeon.max",
          label: "Max Runs",
          type: "number",
          min: -1,
          max: 10,
          help: "-1 = unlimited. 0–10 = stop after N runs.",
        },
        {
          path: "dungeon.schedule",
          label: "Schedule Slot",
          type: "number",
          min: -1,
          max: 47,
          help: "-1 = disabled. 0–47 = 30-minute schedule slot to run dungeon.",
        },
      ],
    },

    // ── Internal / Hidden compatibility fields ────────────────────────────
    {
      id: "hidden_internal",
      title: "Internal",
      hidden: true,
      fields: [
        {
          path: "atk.farmOnArrival",
          label: "Farm on Arrival",
          type: "toggle",
          hidden: true,
          help: "Derived on save: 1 when active farm requested and spot valid; 0 when off.",
        },
        {
          path: "nav.detectSpots",
          label: "Detect Spots",
          type: "action",
          buttonLabel: "Run Spot Detection",
          hidden: true,
          help: "One-shot spot detection compatibility field. Normalized to 0 on normal save.",
        },
      ],
    },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Default control draft for a brand-new account (all modules off). */
export function defaultControlDraft(): ConfigDraft {
  return {
    "atk.mode": 0,
    "atk.map": 0,
    "atk.zone": -1,
    "atk.x": -1,
    "atk.y": -1,
    "atk.radius": 120,
    "atk.hpOn": 0,
    "atk.hpPct": 50,
    "atk.mpOn": 0,
    "atk.mpPct": 50,
    "revive.mode": 1,
    "atk.buffs": "000",
    "atk.zoneMode": 0,
    "atk.zonePick": 1,
    "item.rank": 0,
    "item.mphp": 0,
    "item.gold": 0,
    "mount.on": 0,
    "mount.id": 0,
    "item.medalDialog": 0,
    "item.dropsOn": 0,
    "item.drops": "000000",
    "nav.target": -1,
    "ui.ring": 0,
    "atk.farmOnArrival": 0,
    "nav.detectSpots": 0,
    "revive.delay": 0,
    "revive.on": 0,
    "enhance.on": 0,
    "enhance.maxLv": 7,
    "enhance.charm": 0,
    "dungeon.on": 0,
    "dungeon.max": -1,
    "dungeon.schedule": -1,
  };
}

/** Clamp a number field value to its declared min/max. */
function clampNumber(value: number, min?: number, max?: number): number {
  let v = value;
  if (min !== undefined && v < min) v = min;
  if (max !== undefined && v > max) v = max;
  return v;
}

export const CONFIG_FIELD_LABELS_VI: Partial<Record<ConfigPath, string>> = {
  "atk.mode": "Chế độ tấn công",
  "atk.radius": "Bán kính tấn công",
  "atk.hpOn": "Tự dùng bình HP",
  "atk.hpPct": "Ngưỡng HP",
  "atk.mpOn": "Tự dùng bình MP",
  "atk.mpPct": "Ngưỡng MP",
  "atk.buffs": "Kỹ năng hỗ trợ (Buff)",
  "atk.farmOnArrival": "Tự đánh khi đến nơi",
  "ui.ring": "Hiển thị phạm vi tấn công",
  "atk.zoneMode": "Chế độ khu vực",
  "atk.zonePick": "Khu vực chỉ định",
  "nav.target": "Map mục tiêu di chuyển",
  "nav.detectSpots": "Tìm vị trí đánh",
  "item.rank": "Phẩm cấp vật phẩm",
  "item.mphp": "Nhặt bình HP/MP",
  "item.gold": "Nhặt vàng",
  "item.medalDialog": "Hộp thoại huân chương",
  "item.dropsOn": "Bật lọc đóng hòm đồ",
  "item.drops": "Ô lọc hòm đồ",
  "revive.on": "Tự hồi sinh",
  "revive.mode": "Chế độ hồi sinh",
  "revive.delay": "Thời gian chờ hồi sinh",
  "mount.on": "Dùng thú cưỡi",
  "mount.id": "Loại thú cưỡi",
  "enhance.on": "Tự cường hóa",
  "enhance.maxLv": "Cấp cường hóa tối đa",
  "enhance.charm": "Loại bùa cường hóa",
  "dungeon.on": "Tự đi phó bản",
  "dungeon.max": "Số lượt tối đa",
  "dungeon.schedule": "Khung giờ tham gia",
  "atk.map": "Map ID",
  "atk.zone": "Khu vực",
  "atk.x": "Tọa độ X",
  "atk.y": "Tọa độ Y",
};

/** Return per-field error messages. Empty object = draft is safe to save. */
export function validateDraft(
  draft: ConfigDraft,
  ctlVersion: number,
  attackMapIntent?: string | null,
): ConfigErrors {
  const sections = CONTROL_SCHEMA[ctlVersion];
  if (!sections) return {};

  const errors: ConfigErrors = {};

  for (const section of sections) {
    for (const field of section.fields) {
      if (field.hidden) continue;

      // Conditional validation: atk.zonePick is only validated when atk.zoneMode is Pick (2)
      if (field.path === "atk.zonePick" && Number(draft["atk.zoneMode"]) !== 2) {
        continue;
      }

      const raw = draft[field.path];
      const fieldLabel = CONFIG_FIELD_LABELS_VI[field.path] ?? field.label;

      if (field.type === "toggle") continue;
      if (field.type === "action") continue;

      if (field.type === "select") {
        const n = Number(raw);
        const valid = field.options.some((o) => o.value === n);
        if (!valid) {
          errors[field.path] = `${fieldLabel}: tùy chọn không hợp lệ ${String(raw)}`;
        }
        continue;
      }

      if (field.type === "flags") {
        const s = String(raw ?? "");
        if (s.length !== field.length || !/^[01]+$/.test(s)) {
          errors[field.path] = `${fieldLabel} phải có đúng ${field.length} ký tự '0' hoặc '1'`;
        }
        continue;
      }

      if (
        field.type === "number" ||
        field.type === "travel-map" ||
        field.type === "game-map"
      ) {
        const n = Number(raw);
        if (raw === "" || raw === undefined || raw === null || Number.isNaN(n)) {
          errors[field.path] = `${fieldLabel} phải là một số hợp lệ`;
          continue;
        }
        if (!Number.isInteger(n)) {
          errors[field.path] = `${fieldLabel} phải là số nguyên`;
          continue;
        }
        const clamped = clampNumber(n, field.min, field.max);
        if (clamped !== n) {
          const range = [
            field.min !== undefined ? `tối thiểu ${field.min}` : "",
            field.max !== undefined ? `tối đa ${field.max}` : "",
          ]
            .filter(Boolean)
            .join(", ");
          errors[field.path] = `${fieldLabel} ngoài phạm vi (${range})`;
        }
        continue;
      }
    }
  }

  // Cross-field spot coordinate validations (Zeus.java line 633, control.rs lines 806-815, Round 9B3)
  const spotValidation = validateAttackSpotSave(draft, attackMapIntent);
  for (const [key, msg] of Object.entries(spotValidation.errors)) {
    errors[key as ConfigPath] = msg;
  }

  return errors;
}

/** Convert a raw control record from Supabase/mock to a ConfigDraft. */
export function controlRecordToDraft(
  control: Record<string, unknown>,
): ConfigDraft {
  const defaults = defaultControlDraft();
  const draft = { ...defaults };
  for (const key of Object.keys(defaults) as ConfigPath[]) {
    if (key in control && control[key] !== undefined && control[key] !== null) {
      const raw = control[key];
      if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string") {
        (draft as Record<string, unknown>)[key] = raw;
      }
    }
  }
  return draft;
}

/** Convert a ConfigDraft back to a plain Record for Supabase storage. */
export function draftToControlRecord(
  draft: ConfigDraft,
): Record<string, unknown> {
  return { ...draft } as Record<string, unknown>;
}

// ── Legacy compat — keep until mock-api and seed-data are migrated ──────────

/** @deprecated Matches types.AccountConfig — kept for seed-data.ts / mock-api.ts. */
interface LegacyAccountConfig {
  accountName: string;
  characterName: string;
  serverId: number;
  autoStart: boolean;
  autoRestart: boolean;
  memoryLimitMb: number;
  restartDelaySeconds: number;
  additionalArgs: string;
  automation: {
    autoLogin: boolean;
    autoPickServer: boolean;
    startupDelaySeconds: number;
    restartEveryMinutes: number;
    followSchedule: boolean;
    activeFrom: string;
    activeTo: string;
  };
}

/**
 * @deprecated Use `defaultControlDraft()` for the 34-key control block.
 * This shim exists only for seed-data.ts / mock-api.ts compatibility.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function defaultAccountConfig(accountName: string): any {
  const cfg: LegacyAccountConfig = {
    accountName,
    characterName: "",
    serverId: 1,
    autoStart: true,
    autoRestart: true,
    memoryLimitMb: 512,
    restartDelaySeconds: 20,
    additionalArgs: "",
    automation: {
      autoLogin: true,
      autoPickServer: true,
      startupDelaySeconds: 25,
      restartEveryMinutes: 0,
      followSchedule: false,
      activeFrom: "00:00",
      activeTo: "23:59",
    },
  };
  return cfg;
}
