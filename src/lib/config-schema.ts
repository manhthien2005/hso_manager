/**
 * Schema-driven config form — version-keyed against the jar wire contract.
 *
 * The key set is the authority:
 *   Legacy v13/v14: 35 wire lines (including `v`) / 34 stored keys in `accounts.control`.
 *   v15 (Bạch Hổ / v4.0.3): 38 wire lines (including `v`) / 37 stored keys in `accounts.control`
 *     (removes legacy dungeon.schedule; adds dungeon.startMin, dungeon.endMin, ui.effects, ui.hidePlayers).
 *   `v` is stored separately in `accounts.control_version` and `devices.jar_ctl_version`.
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
import { MATERIAL_DROP_LABELS } from "./material-drops";

export { normalizeDraftForSave, updateLocationWithZoneReset };

// ── Value types ──────────────────────────────────────────────────────────────

export type ConfigValue = string | number | boolean;

// ── Path union — every key in the control block (v13/v14 legacy and v15) ────

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
  | "dungeon.schedule"
  | "dungeon.startMin"
  | "dungeon.endMin"
  | "ui.effects"
  | "ui.hidePlayers";

export const VISUAL_QOL_KEYS = ["ui.effects", "ui.hidePlayers"] as const;
export type VisualQoLPath = (typeof VISUAL_QOL_KEYS)[number];

export const VISUAL_QOL_DEFAULTS: Record<VisualQoLPath, ConfigValue> = {
  "ui.effects": 1,
  "ui.hidePlayers": 0,
};

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

const CONTROL_SCHEMA_V13: ConfigSection[] = [
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
          label: "Material Drop Filter",
          type: "toggle",
          help: "Automatically reconcile material drop desired state with game server.",
        },
        {
          path: "item.drops",
          label: "Material Drop Slots",
          type: "flags",
          length: 6,
          bitLabels: [...MATERIAL_DROP_LABELS],
          help: "Close (1) or open (0) each material drop slot. 1 = Do not drop, 0 = Allow drop.",
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
  ];

const VISUAL_QOL_SECTION: ConfigSection = {
  id: "visual_qol",
  title: "Giao diện & Hiệu ứng",
  description: "Tùy chọn hiển thị và hiệu ứng hình ảnh.",
  fields: [
    {
      path: "ui.effects",
      label: "Hiệu ứng hình ảnh",
      type: "toggle",
      help: "Tắt hiệu ứng giúp giảm tải hiển thị ở khu vực đông người.",
    },
    {
      path: "ui.hidePlayers",
      label: "Người chơi khác",
      type: "select",
      help: "Cấu hình hiển thị nhân vật người chơi khác để giảm tải.",
      options: [
        { value: 0, label: "Hiện tất cả" },
        { value: 1, label: "Ẩn đơn giản / hiện bóng" },
        { value: 2, label: "Ẩn toàn bộ / chỉ hiện tên" },
      ],
    },
  ],
};

const DUNGEON_SECTION_V15: ConfigSection = {
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
      help: "-1 = unlimited; 1–10 = finite run limit; 0 is invalid.",
    },
    {
      path: "dungeon.startMin",
      label: "Start Minute",
      type: "number",
      min: -1,
      max: 1439,
      help: "-1 = unscheduled. 0–1439 = daily start minute (UTC+7).",
    },
    {
      path: "dungeon.endMin",
      label: "End Minute",
      type: "number",
      min: -1,
      max: 1439,
      help: "-1 = unscheduled. 0–1439 = daily end minute (UTC+7).",
    },
  ],
};

export const CONTROL_SCHEMA_V15: ConfigSection[] = [
  ...CONTROL_SCHEMA_V13.filter((s) => s.id !== "dungeon" && s.id !== "hidden_internal"),
  DUNGEON_SECTION_V15,
  VISUAL_QOL_SECTION,
  ...CONTROL_SCHEMA_V13.filter((s) => s.id === "hidden_internal"),
];

export const CONTROL_SCHEMA: Record<number, ConfigSection[]> = {
  13: CONTROL_SCHEMA_V13,
  14: [
    ...CONTROL_SCHEMA_V13.filter((s) => s.id !== "hidden_internal"),
    VISUAL_QOL_SECTION,
    ...CONTROL_SCHEMA_V13.filter((s) => s.id === "hidden_internal"),
  ],
  15: CONTROL_SCHEMA_V15,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Default control draft for a brand-new account (all modules off). */
export function defaultControlDraft(version: number = 13): ConfigDraft {
  const draft: Record<string, ConfigValue> = {
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
  };

  if (version === 15) {
    draft["dungeon.startMin"] = -1;
    draft["dungeon.endMin"] = -1;
    draft["ui.effects"] = 1;
    draft["ui.hidePlayers"] = 0;
  } else if (version === 14) {
    draft["dungeon.schedule"] = -1;
    draft["ui.effects"] = 1;
    draft["ui.hidePlayers"] = 0;
  } else {
    draft["dungeon.schedule"] = -1;
  }

  return draft as ConfigDraft;
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
  "item.medalDialog": "Tự động xử lý hộp thoại mề đay",
  "item.dropsOn": "Tự động quản lý rớt nguyên liệu",
  "item.drops": "Cấu hình rớt nguyên liệu",
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
  "dungeon.startMin": "Giờ bắt đầu phó bản",
  "dungeon.endMin": "Giờ kết thúc phó bản",
  "atk.map": "Map ID",
  "atk.zone": "Khu vực",
  "atk.x": "Tọa độ X",
  "atk.y": "Tọa độ Y",
  "ui.effects": "Hiệu ứng hình ảnh",
  "ui.hidePlayers": "Người chơi khác",
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

      if (field.path === "ui.effects") {
        const n = Number(raw);
        if (
          raw === "" ||
          raw === undefined ||
          raw === null ||
          Number.isNaN(n) ||
          !Number.isInteger(n) ||
          (n !== 0 && n !== 1)
        ) {
          errors[field.path] = `${fieldLabel}: tùy chọn không hợp lệ ${String(raw)}`;
          continue;
        }
      }

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

  // CTL15 semantic validation (Zeus.java line 633 & line 810, control.rs lines 806-815 & 974)
  if (ctlVersion === 15) {
    // 1. dungeon.max validation: domain is -1 or 1..10; 0 is strictly rejected
    const maxRaw = draft["dungeon.max"];
    const maxVal = typeof maxRaw === "number" ? maxRaw : Number(maxRaw);
    if (!errors["dungeon.max"]) {
      if (maxVal === 0) {
        errors["dungeon.max"] =
          "Số lượt đi phó bản không hợp lệ: -1 (không giới hạn) hoặc 1–10 (giới hạn lượt); giá trị 0 không hợp lệ";
      } else if (maxVal !== -1 && (maxVal < 1 || maxVal > 10 || !Number.isInteger(maxVal))) {
        errors["dungeon.max"] =
          "Số lượt đi phó bản ngoài phạm vi (-1 hoặc 1–10)";
      }
    }

    // 2. Schedule validation
    const startRaw = draft["dungeon.startMin"];
    const endRaw = draft["dungeon.endMin"];
    const startMin = typeof startRaw === "number" ? startRaw : Number(startRaw);
    const endMin = typeof endRaw === "number" ? endRaw : Number(endRaw);

    const hasStartErr = Boolean(errors["dungeon.startMin"]);
    const hasEndErr = Boolean(errors["dungeon.endMin"]);

    if (!hasStartErr && !hasEndErr) {
      const unscheduled = startMin === -1 && endMin === -1;
      const validScheduled =
        startMin >= 0 &&
        startMin <= 1439 &&
        endMin >= 0 &&
        endMin <= 1439 &&
        startMin < endMin;

      if (!unscheduled && !validScheduled) {
        if (startMin === -1 && endMin !== -1) {
          errors["dungeon.startMin"] =
            "Lịch phó bản không hợp lệ: cả hai giá trị phải là -1 hoặc 0-1439 (bắt đầu < kết thúc)";
        } else if (startMin !== -1 && endMin === -1) {
          errors["dungeon.endMin"] =
            "Lịch phó bản không hợp lệ: cả hai giá trị phải là -1 hoặc 0-1439 (bắt đầu < kết thúc)";
        } else if (startMin === endMin) {
          errors["dungeon.startMin"] = "Giờ bắt đầu và kết thúc phó bản không được trùng nhau";
          errors["dungeon.endMin"] = "Giờ bắt đầu và kết thúc phó bản không được trùng nhau";
        } else if (startMin > endMin) {
          errors["dungeon.startMin"] = "Giờ bắt đầu phó bản phải nhỏ hơn giờ kết thúc";
          errors["dungeon.endMin"] = "Giờ kết thúc phó bản phải lớn hơn giờ bắt đầu";
        } else {
          errors["dungeon.startMin"] = "Lịch phó bản ngoài phạm vi cho phép (0-1439 hoặc -1)";
        }
      }
    }
  }

  return errors;
}

export function resolveAccountControlVersion(rawVersion?: number | null): number {
  if (rawVersion === 15) return 15;
  if (rawVersion === 14) return 14;
  return 13;
}

/**
 * Explicit helper for converting persisted v13/v14 control into a v15 editing draft.
 *
 * Rules:
 * - Preserves every common control field whose semantics are unchanged (keys 1..33).
 * - Drops legacy dungeon.schedule from the outgoing v15 record.
 * - Adds dungeon.startMin and dungeon.endMin.
 * - Does not silently reinterpret legacy dungeon.schedule as a daily window.
 * - When promoting a legacy account, uses safe unscheduled state (-1, -1) unless persisted control
 *   already contains valid v15 values.
 * - Preserves ui.effects/ui.hidePlayers from v14 when present.
 * - For v13 records where those fields do not exist, uses canonical v15 defaults (effects: 1, hidePlayers: 0).
 * - After migration, draftToControlRecord(draft, 15) contains exactly the authoritative 37 stored keys.
 */
export function migrateLegacyControlToV15Draft(
  control: Record<string, unknown>,
  sourceVersion?: number | null,
): ConfigDraft {
  void sourceVersion;
  const defaults = defaultControlDraft(15);
  const draft = { ...defaults };

  const sections = CONTROL_SCHEMA[15];
  const v15AllowedKeys = new Set(sections.flatMap((s) => s.fields.map((f) => f.path)));

  for (const [key, raw] of Object.entries(control)) {
    if (key === "dungeon.schedule") {
      continue;
    }
    if (key === "dungeon.startMin" || key === "dungeon.endMin") {
      continue;
    }
    if (key === "ui.effects" || key === "ui.hidePlayers") {
      continue;
    }
    if (v15AllowedKeys.has(key as ConfigPath) && raw !== undefined && raw !== null) {
      if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string") {
        draft[key as ConfigPath] = raw;
      }
    }
  }

  // Preserve ui.effects/ui.hidePlayers from v14 when present and valid; otherwise canonical defaults
  if (control["ui.effects"] !== undefined && control["ui.effects"] !== null) {
    const eff = Number(control["ui.effects"]);
    if (eff === 0 || eff === 1) {
      draft["ui.effects"] = eff;
    }
  }
  if (control["ui.hidePlayers"] !== undefined && control["ui.hidePlayers"] !== null) {
    const hp = Number(control["ui.hidePlayers"]);
    if (hp === 0 || hp === 1 || hp === 2) {
      draft["ui.hidePlayers"] = hp;
    }
  }

  // Handle dungeon.startMin & dungeon.endMin:
  // Legacy dungeon.schedule is never translated into a window.
  // Only preserve if control already contains valid v15 values.
  const startRaw = control["dungeon.startMin"];
  const endRaw = control["dungeon.endMin"];
  if (startRaw !== undefined && startRaw !== null && endRaw !== undefined && endRaw !== null) {
    const start = Number(startRaw);
    const end = Number(endRaw);
    const unscheduled = start === -1 && end === -1;
    const validScheduled =
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      start >= 0 &&
      start <= 1439 &&
      end >= 0 &&
      end <= 1439 &&
      start < end;
    if (unscheduled || validScheduled) {
      draft["dungeon.startMin"] = start;
      draft["dungeon.endMin"] = end;
    } else {
      draft["dungeon.startMin"] = -1;
      draft["dungeon.endMin"] = -1;
    }
  } else {
    draft["dungeon.startMin"] = -1;
    draft["dungeon.endMin"] = -1;
  }

  return draft;
}

export const convertLegacyControlToV15Draft = migrateLegacyControlToV15Draft;

/**
 * Resolves the schema version to render in the UI based on target control version and device jar CTL version.
 */
export function resolveEffectiveSchemaVersion(
  targetControlVersion: number,
  jarCtlVersion?: number | null,
): number {
  if (targetControlVersion === 15 || jarCtlVersion === 15) {
    return 15;
  }
  if (jarCtlVersion === 13) {
    return 13;
  }
  return 14;
}

/**
 * Helper to obtain the canonical initial/persisted editing draft based on account control and target version.
 */
export function getEffectiveInitialDraft(
  control: Record<string, unknown> | null | undefined,
  accountVersion: number,
  targetVersion: number,
): ConfigDraft {
  if (targetVersion === 15) {
    return control
      ? migrateLegacyControlToV15Draft(control, accountVersion)
      : defaultControlDraft(15);
  }
  return control
    ? controlRecordToDraft(control, accountVersion)
    : defaultControlDraft(accountVersion);
}

/** Convert a raw control record from Supabase/mock to a ConfigDraft. */
export function controlRecordToDraft(
  control: Record<string, unknown>,
  targetVersion: number = 13,
): ConfigDraft {
  if (targetVersion === 15) {
    return migrateLegacyControlToV15Draft(control, 15);
  }
  const defaults = defaultControlDraft(targetVersion);
  const draft = { ...defaults } as Record<string, unknown>;
  for (const [key, raw] of Object.entries(control)) {
    if (raw !== undefined && raw !== null) {
      if (typeof raw === "number" || typeof raw === "boolean" || typeof raw === "string") {
        draft[key] = raw;
      }
    }
  }
  return draft as ConfigDraft;
}

/** Convert a ConfigDraft back to a plain Record for Supabase storage based on target CTL version. */
export function draftToControlRecord(
  draft: ConfigDraft,
  targetVersion: number = 13,
): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  const sections = CONTROL_SCHEMA[targetVersion] ?? CONTROL_SCHEMA[13];
  const allowedKeys = new Set(sections.flatMap((s) => s.fields.map((f) => f.path)));
  for (const key of allowedKeys) {
    if (key in draft && draft[key] !== undefined) {
      record[key] = draft[key];
    }
  }
  return record;
}

/**
 * Checks whether an account control version is compatible with a device's reported jar CTL version.
 *
 * Rules:
 * - Device version must be known (not null/undefined/<=0).
 * - Device CTL version must be >= account control version.
 * - If account is newer than device (e.g. account 15 on device 14/13, or account 14 on device 13),
 *   returns false to fail closed and block saving.
 */
export function isControlVersionCompatibleWithDevice(
  accountVersion: number | null | undefined,
  deviceVersion: number | null | undefined,
): boolean {
  if (deviceVersion === null || deviceVersion === undefined || deviceVersion <= 0) {
    return false;
  }
  const accVer = resolveAccountControlVersion(accountVersion);
  return deviceVersion >= accVer;
}

export interface ControlSavePayload {
  control: Record<string, unknown>;
  controlVersion: number;
}

/**
 * Builds the authoritative save payload for an account configuration.
 * Fails closed and throws if the account version is newer than the device jar CTL version,
 * preventing any incompatible control payload from being generated or submitted to older runtimes.
 */
export function buildControlSavePayload(
  draft: ConfigDraft,
  accountVersion: number | null | undefined,
  deviceCtlVersion: number | null | undefined,
  options?: {
    isDeviceQoLCapable?: boolean;
    qolSettingsEdited?: boolean;
    attackMapIntent?: string | null;
  },
): ControlSavePayload {
  const accountVer = resolveAccountControlVersion(accountVersion);
  if (!isControlVersionCompatibleWithDevice(accountVer, deviceCtlVersion)) {
    throw new Error(
      `Không thể lưu cấu hình: Phiên bản cấu hình tài khoản (v${accountVer}) mới hơn phiên bản CTL của máy chủ (v${deviceCtlVersion ?? "chưa rõ"}). Không cho phép hạ cấp cấu hình.`,
    );
  }
  const targetVersion = determineControlVersionForSave({
    accountControlVersion: accountVer,
    deviceJarCtlVersion: deviceCtlVersion,
    isDeviceQoLCapable: options?.isDeviceQoLCapable,
    qolSettingsEdited: options?.qolSettingsEdited,
  });
  const normalizedDraft = normalizeDraftForSave(draft);
  const control = draftToControlRecord(normalizedDraft, targetVersion);
  return {
    control,
    controlVersion: targetVersion,
  };
}

export interface VersionSelectionInput {
  accountControlVersion?: number | null;
  isDeviceQoLCapable?: boolean;
  qolSettingsEdited?: boolean;
  deviceJarCtlVersion?: number | null;
}

/**
 * Determines whether to save an account configuration as Control v13, v14, or v15.
 *
 * Rules:
 * - Device reporting jar_ctl_version=15 => Save produces control_version=15 (promotes v13/v14, preserves v15).
 * - Existing account already at v15 => remains v15 (never silently downgrade).
 * - Existing v14 account => always remains v14 (never silently downgrade).
 * - Device reporting jar_ctl_version=13 => remains 13 (never promote to unsupported version).
 * - Existing v13 account + device capable + user edited QoL setting => promote to v14.
 * - Existing v13 account + unrelated save => preserve v13.
 * - Existing v13 account + device not capable => preserve v13.
 */
export function determineControlVersionForSave(input: VersionSelectionInput): number {
  const deviceCtl = input.deviceJarCtlVersion ?? null;
  const accountCtl = resolveAccountControlVersion(input.accountControlVersion);

  if (deviceCtl === 15) {
    return 15;
  }
  if (accountCtl === 15) {
    return 15;
  }
  if (accountCtl === 14) {
    return 14;
  }
  if (deviceCtl === 13) {
    return 13;
  }
  if (input.isDeviceQoLCapable && input.qolSettingsEdited) {
    return 14;
  }
  return 13;
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
