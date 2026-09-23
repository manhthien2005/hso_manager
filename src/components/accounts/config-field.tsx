"use client";

import { useState } from "react";
import type {
  ConfigDraft,
  ConfigField,
  ConfigFieldAction,
  ConfigFieldFlags,
  ConfigFieldSelect,
  ConfigPath,
  ConfigValue,
} from "@/lib/config-schema";
import {
  GAME_MAPS,
  GAME_MAP_BY_ID,
  TRAVEL_SUPPORTED_MAPS,
  formatGameMap,
  getGameMap,
} from "@/lib/game-maps";
import {
  ATTACK_SPOT_NONE_SENTINEL,
  getAttackMapSelectValue,
  handleAttackMapSelection,
  isAttackSpotConfigured,
} from "@/lib/attack-spot";
import {
  MOUNT_NAMES,
  parseCarriedMountIds,
  getMountDisplayLabel,
} from "@/lib/mounts";
import {
  MATERIAL_DROP_SLOTS,
  MATERIAL_DROP_LABELS,
  setMaterialDropBit,
} from "@/lib/material-drops";
import { SelectField, TextField, ToggleField } from "@/components/ui/field";

const FIELD_METADATA: Record<
  string,
  {
    label?: string;
    help?: string;
    options?: Record<number, string>;
    bitLabels?: string[];
    buttonLabel?: string;
  }
> = {
  "atk.mode": {
    label: "Chế độ tấn công",
    help: "Đứng yên: đánh tại chỗ. Di chuyển: bám theo quái.",
    options: {
      0: "Tắt",
      1: "Đứng yên",
      2: "Di chuyển",
    },
  },
  "atk.radius": {
    label: "Bán kính tấn công",
    help: "Bán kính pixel quanh vị trí đánh. Giới hạn 60–240.",
  },
  "atk.hpOn": {
    label: "Tự dùng bình HP",
    help: "Tự động sử dụng bình HP khi máu thấp.",
  },
  "atk.hpPct": {
    label: "Ngưỡng HP",
    help: "Sử dụng bình HP khi lượng máu dưới mức này.",
  },
  "atk.mpOn": {
    label: "Tự dùng bình MP",
    help: "Tự động sử dụng bình MP khi năng lượng thấp.",
  },
  "atk.mpPct": {
    label: "Ngưỡng MP",
    help: "Sử dụng bình MP khi năng lượng dưới mức này.",
  },
  "atk.buffs": {
    label: "Kỹ năng hỗ trợ (Buff)",
    help: "Kích hoạt các ô kỹ năng hỗ trợ đã học.",
    bitLabels: ["Ô 1", "Ô 2", "Ô 3"],
  },
  "atk.farmOnArrival": {
    label: "Tự đánh khi đến nơi",
    help: "Bắt đầu tấn công ngay khi di chuyển đến vị trí (mặc định tắt).",
  },
  "ui.ring": {
    label: "Hiển thị phạm vi tấn công",
    help: "Hiển thị vòng tròn bán kính tấn công trên màn hình (chỉ hiển thị cục bộ).",
  },
  "atk.zoneMode": {
    label: "Chế độ khu vực",
    options: {
      0: "Giữ nguyên (ở lại khu vực hiện tại)",
      1: "Vắng nhất (ít người chơi nhất)",
      2: "Chỉ định (chọn khu vực cụ thể)",
    },
  },
  "atk.zonePick": {
    label: "Khu vực chỉ định",
    help: "Số thứ tự khu vực khi chọn chế độ 'Chỉ định'.",
  },
  "nav.target": {
    label: "Map mục tiêu di chuyển",
    help: "Map ID cần di chuyển đến. -1 = tắt. Agent sẽ tự tắt sau khi đến nơi.",
  },
  "nav.detectSpots": {
    label: "Tìm vị trí đánh",
    buttonLabel: "Quét vị trí đánh",
    help: "Thao tác một lần: yêu cầu Agent quét tìm vị trí đánh hợp lệ. Tự đặt lại sau khi thực hiện.",
  },
  "item.rank": {
    label: "Phẩm cấp vật phẩm",
    help: 'Nhặt phẩm cấp này trở lên. "Tất cả" nhặt mọi thứ; "Không nhặt" bỏ qua tất cả đồ.',
    options: {
      0: "Tất cả (nhặt mọi vật phẩm)",
      1: "Lam trở lên",
      2: "Vàng trở lên",
      3: "Tím trở lên",
      4: "Cam trở lên",
      5: "Không nhặt (bỏ qua tất cả)",
    },
  },
  "item.mphp": {
    label: "Nhặt bình HP/MP",
    options: {
      0: "Tất cả (cả HP và MP)",
      1: "Chỉ nhặt HP",
      2: "Chỉ nhặt MP",
      3: "Không nhặt",
    },
  },
  "item.gold": {
    label: "Nhặt vàng",
    options: {
      0: "Nhặt vàng",
      1: "Bỏ qua vàng",
    },
  },
  "item.medalDialog": {
    label: "Tự động xử lý hộp thoại mề đay",
    help: "Tự động đóng hộp thoại nhận thưởng / mề đay khi xuất hiện.",
  },
  "item.dropsOn": {
    label: "Tự động quản lý rớt nguyên liệu",
    help: "Khi bật, tool sẽ đồng bộ trạng thái rớt nguyên liệu theo cấu hình bên dưới.",
  },
  "item.drops": {
    label: "Trạng thái rớt nguyên liệu",
    bitLabels: [...MATERIAL_DROP_LABELS],
    help: "Bật = Đóng rớt (chặn không cho rơi). Tắt = Mở rớt (cho phép rơi bình thường).",
  },
  "revive.on": {
    label: "Tự hồi sinh",
    help: "Tự động hồi sinh sau khi nhân vật tử vong.",
  },
  "revive.mode": {
    label: "Chế độ hồi sinh",
    help: "Cách thức hồi sinh. Muốn tắt hồi sinh hãy dùng nút Tự hồi sinh ở trên.",
    options: {
      1: "Hồi sinh tại chỗ",
      2: "Về làng",
    },
  },
  "revive.delay": {
    label: "Thời gian chờ hồi sinh",
    help: "Thời gian chờ (giây) trên mặt đất trước khi hồi sinh.",
  },
  "mount.on": {
    label: "Dùng thú cưỡi",
    help: "Tự động cưỡi thú khi di chuyển trong bãi đánh.",
  },
  "mount.id": {
    label: "Loại thú cưỡi",
    help: "0 = bất kỳ thú cưỡi nào có sẵn.",
    options: MOUNT_NAMES,
  },
  "enhance.on": {
    label: "Tự cường hóa",
    help: "Tự động cường hóa trang bị khi đủ điều kiện.",
  },
  "enhance.maxLv": {
    label: "Cấp cường hóa tối đa",
    help: "Dừng cường hóa khi đạt cấp độ này.",
  },
  "enhance.charm": {
    label: "Loại bùa cường hóa",
    options: {
      0: "Không dùng bùa",
      1: "Bùa 1",
      2: "Bùa 2",
      3: "Bùa 3",
    },
  },
  "dungeon.on": {
    label: "Tự đi phó bản",
    help: "Tự động tham gia phó bản khi mở.",
  },
  "dungeon.max": {
    label: "Số lượt tối đa",
    help: "-1 = không giới hạn. 0–10 = dừng sau N lượt.",
  },
  "dungeon.schedule": {
    label: "Khung giờ tham gia",
    help: "-1 = tắt. 0–47 = khung giờ 30 phút tham gia phó bản.",
  },
  "atk.map": {
    label: "Map ID",
    help: "0 = chưa đặt vị trí đánh.",
  },
  "atk.zone": {
    label: "Khu vực",
    help: "-1 = không chọn khu vực cụ thể.",
  },
  "atk.x": {
    label: "Tọa độ X",
    help: "-1 = chưa đặt vị trí.",
  },
  "atk.y": {
    label: "Tọa độ Y",
    help: "-1 = chưa đặt vị trí.",
  },
};

/**
 * Renders one field from its schema descriptor.
 * The config page owns draft state and validation; this only maps
 * `ConfigField.type` to an input and reports raw values back.
 *
 * Supported types: toggle, number, select, flags, action, travel-map, game-map.
 * Number values stay numbers in the draft (not strings), so validation
 * compares numeric ranges directly without a parse step.
 */

export function ConfigFieldInput({
  field,
  value,
  values,
  error,
  disabled,
  onChange,
  onBatchChange,
  attackMapIntent,
  onAttackMapIntentChange,
  telemetryMounts,
}: {
  field: ConfigField;
  value: ConfigValue;
  values?: ConfigDraft;
  error?: string;
  disabled?: boolean;
  onChange(path: ConfigPath, value: ConfigValue): void;
  onBatchChange?(updates: Partial<Record<ConfigPath, ConfigValue>>): void;
  attackMapIntent?: string | null;
  onAttackMapIntentChange?(intent: string | null): void;
  telemetryMounts?: string | null;
}) {
  const id = `cfg-${field.path.replace(/\./g, "-")}`;
  const set = (next: ConfigValue) => onChange(field.path, next);

  const meta = FIELD_METADATA[field.path];
  const label = meta?.label ?? field.label;
  const help = meta?.help ?? field.help;

  if (field.path === "atk.map") {
    return (
      <AttackMapFieldInput
        field={field}
        value={value}
        values={values}
        error={error}
        disabled={disabled}
        onChange={onChange}
        onBatchChange={onBatchChange}
        attackMapIntent={attackMapIntent}
        onAttackMapIntentChange={onAttackMapIntentChange}
      />
    );
  }

  if (field.type === "toggle") {
    return (
      <ToggleField
        id={id}
        label={label}
        help={help}
        checked={value === true || value === 1 || value === "1"}
        disabled={disabled}
        onChange={(next) => set(next ? 1 : 0)}
      />
    );
  }

  if (field.type === "select") {
    const isMountId = field.path === "mount.id";
    const carriedIds =
      isMountId && telemetryMounts
        ? new Set(parseCarriedMountIds(telemetryMounts))
        : null;

    return (
      <SelectField
        id={id}
        label={label}
        help={help}
        error={error}
        options={(field as ConfigFieldSelect).options.map((o) => {
          let optLabel = meta?.options?.[o.value] ?? o.label;
          if (isMountId && typeof o.value === "number") {
            optLabel = getMountDisplayLabel(o.value, carriedIds);
          }
          return {
            value: String(o.value),
            label: optLabel,
          };
        })}
        value={String(value)}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value))}
      />
    );
  }

  if (field.type === "travel-map") {
    const numValue = typeof value === "number" ? value : Number(value);
    const hasValidNum =
      value !== "" &&
      value !== undefined &&
      value !== null &&
      !Number.isNaN(numValue) &&
      Number.isInteger(numValue);

    let diagnosticOption: { value: string; label: string } | null = null;
    if (hasValidNum && numValue !== -1) {
      const isSupported = TRAVEL_SUPPORTED_MAPS.some((m) => m.id === numValue);
      if (!isSupported) {
        const catalogMap = GAME_MAP_BY_ID.get(numValue);
        if (catalogMap) {
          diagnosticOption = {
            value: String(numValue),
            label: `Điểm đến không hỗ trợ [${numValue}] ${catalogMap.name}`,
          };
        } else {
          diagnosticOption = {
            value: String(numValue),
            label: `Điểm đến không xác định [${numValue}]`,
          };
        }
      }
    }

    const options = [
      { value: "-1", label: "Tắt" },
      ...(diagnosticOption ? [diagnosticOption] : []),
      ...TRAVEL_SUPPORTED_MAPS.map((m) => ({
        value: String(m.id),
        label: `[${m.id}] ${m.name}`,
      })),
    ];

    const currentMap =
      hasValidNum && numValue !== -1 ? GAME_MAP_BY_ID.get(numValue) : undefined;
    const selectedNotes = currentMap?.notes;
    const effectiveHelp = selectedNotes
      ? `${help ? `${help} · ` : ""}${selectedNotes}`
      : help;

    return (
      <SelectField
        id={id}
        label={label}
        help={effectiveHelp}
        error={error}
        options={options}
        value={hasValidNum ? String(numValue) : "-1"}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value))}
      />
    );
  }

  if (field.type === "game-map") {
    const numValue = typeof value === "number" ? value : Number(value);
    const hasValidNum =
      value !== "" &&
      value !== undefined &&
      value !== null &&
      !Number.isNaN(numValue) &&
      Number.isInteger(numValue);

    let diagnosticOption: { value: string; label: string } | null = null;
    if (hasValidNum && !GAME_MAP_BY_ID.has(numValue)) {
      diagnosticOption = {
        value: String(numValue),
        label: formatGameMap(numValue),
      };
    }

    const options = [
      ...(diagnosticOption ? [diagnosticOption] : []),
      ...GAME_MAPS.map((m) => ({
        value: String(m.id),
        label: `[${m.id}] ${m.name}`,
      })),
    ];

    const currentMap = hasValidNum ? getGameMap(numValue) : undefined;
    const selectedNotes = currentMap?.notes;
    const effectiveHelp = selectedNotes
      ? `${help ? `${help} · ` : ""}${selectedNotes}`
      : help;

    return (
      <SelectField
        id={id}
        label={label}
        help={effectiveHelp}
        error={error}
        options={options}
        value={hasValidNum ? String(numValue) : "0"}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value))}
      />
    );
  }

  if (field.path === "item.drops") {
    const str = String(value ?? "").padEnd(6, "0");
    const isMasterOn = values ? Number(values["item.dropsOn"]) === 1 : true;

    return (
      <div className="space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <span className="block text-xs font-semibold text-foreground">{label}</span>
            {help ? <p className="mt-0.5 text-xs text-muted/80">{help}</p> : null}
          </div>
          <span className="font-mono text-[11px] text-muted rounded bg-elevated px-2 py-0.5 border border-border/60">
            Mã: {str}
          </span>
        </div>

        {!isMasterOn ? (
          <div className="rounded-md border border-border/60 bg-elevated/40 p-2.5 text-xs text-muted">
            Tự động quản lý đang tắt. Cấu hình bên dưới vẫn được lưu và sẽ áp dụng khi bạn bật công tắc chính.
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
          {MATERIAL_DROP_SLOTS.map((slot) => {
            const isClosed = str[slot.index] === "1";
            return (
              <div
                key={slot.index}
                className={`rounded-md border p-3 transition-colors ${
                  isClosed
                    ? "border-warning/40 bg-warning/5"
                    : "border-border/70 bg-elevated/30"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {slot.label}
                      </span>
                      <span
                        className={`inline-flex items-center rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold border ${
                          isClosed
                            ? "border-warning/40 bg-warning/15 text-warning"
                            : "border-accent/40 bg-accent/15 text-accent"
                        }`}
                      >
                        {isClosed ? "Đóng rớt" : "Mở rớt"}
                      </span>
                    </div>
                    <p className="text-xs text-muted">
                      {isClosed
                        ? "Chặn không nhận vật phẩm này"
                        : "Cho phép nhận khi đánh quái"}
                    </p>
                  </div>
                  <button
                    id={`${id}-${slot.index}`}
                    type="button"
                    role="switch"
                    aria-checked={isClosed}
                    disabled={disabled}
                    onClick={() => {
                      const nextVal = setMaterialDropBit(str, slot.index, !isClosed);
                      set(nextVal);
                    }}
                    className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors duration-100 disabled:opacity-50 ${
                      isClosed ? "border-accent bg-accent/30" : "border-border bg-elevated"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 size-5 rounded-full transition-[left] duration-100 ${
                        isClosed ? "left-[22px] bg-accent" : "left-0.5 bg-muted"
                      }`}
                      aria-hidden="true"
                    />
                    <span className="sr-only">
                      {slot.label}: {isClosed ? "Đóng rớt" : "Mở rớt"}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        {error ? (
          <p className="text-xs font-medium text-danger flex items-center gap-1">
            <IconWarning />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    );
  }

  if (field.type === "flags") {
    const f = field as ConfigFieldFlags;
    const str = String(value ?? "").padEnd(f.length, "0");
    const bitLabels = meta?.bitLabels ?? f.bitLabels;
    return (
      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-muted">{label}</span>
        {help ? <p className="text-xs text-muted/80">{help}</p> : null}
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {bitLabels.map((bitLabel, i) => (
            <ToggleField
              key={i}
              id={`${id}-${i}`}
              label={bitLabel}
              checked={str[i] === "1"}
              disabled={disabled}
              onChange={(next) => {
                const chars = str.split("");
                chars[i] = next ? "1" : "0";
                set(chars.join(""));
              }}
            />
          ))}
        </div>
        {error ? (
          <p className="text-xs font-medium text-danger flex items-center gap-1">
            <IconWarning />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    );
  }

  if (field.type === "action") {
    const f = field as ConfigFieldAction;
    const armed = value === 1 || value === true || value === "1";
    const buttonLabel = meta?.buttonLabel ?? f.buttonLabel;
    return (
      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-muted">{label}</span>
        {help ? <p className="text-xs text-muted/80">{help}</p> : null}
        <button
          id={id}
          type="button"
          disabled={disabled || armed}
          onClick={() => set(1)}
          className="inline-flex min-h-[36px] items-center rounded-md border border-border bg-elevated px-4 text-xs font-semibold uppercase tracking-wider text-foreground transition-colors hover:border-accent/40 hover:bg-elevated/80 disabled:opacity-50"
        >
          {armed ? "Đang gửi…" : buttonLabel}
        </button>
        {error ? (
          <p className="text-xs font-medium text-danger flex items-center gap-1">
            <IconWarning />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    );
  }

  // number (default)
  const numField = field.type === "number" ? field : null;
  return (
    <TextField
      id={id}
      label={label}
      help={help}
      error={error}
      type="number"
      inputMode="numeric"
      min={numField?.min}
      max={numField?.max}
      suffix={numField?.suffix}
      placeholder={numField?.min !== undefined ? String(numField.min) : undefined}
      disabled={disabled}
      value={String(value)}
      onChange={(e) => set(e.target.value === "" ? "" : Number(e.target.value))}
    />
  );
}

/**
 * Dedicated Attack Map Selector (Round 9B3).
 *
 * Implements presentation-only "No attack spot" option without modifying
 * the persisted wire contract (which uses atk.map=0, zone=-1, x=-1, y=-1).
 * Distinguishes canonical no-spot from real Map 0 (x >= 0, y >= 0).
 */
function AttackMapFieldInput({
  field,
  value,
  values,
  error,
  disabled,
  onChange,
  onBatchChange,
  attackMapIntent,
  onAttackMapIntentChange,
}: {
  field: ConfigField;
  value: ConfigValue;
  values?: ConfigDraft;
  error?: string;
  disabled?: boolean;
  onChange(path: ConfigPath, value: ConfigValue): void;
  onBatchChange?(updates: Partial<Record<ConfigPath, ConfigValue>>): void;
  attackMapIntent?: string | null;
  onAttackMapIntentChange?(intent: string | null): void;
}) {
  const [localSelectedOption, setLocalSelectedOption] = useState<string | null>(null);
  const userSelectedOption = attackMapIntent !== undefined ? attackMapIntent : localSelectedOption;
  const id = `cfg-${field.path.replace(/\./g, "-")}`;

  const meta = FIELD_METADATA[field.path];
  const label = meta?.label ?? field.label;

  const numValue = typeof value === "number" ? value : Number(value);
  const hasValidNum =
    value !== "" &&
    value !== undefined &&
    value !== null &&
    !Number.isNaN(numValue) &&
    Number.isInteger(numValue);

  const coords = { x: values?.["atk.x"], y: values?.["atk.y"] };
  const isConfigured = isAttackSpotConfigured(coords);
  const selectValue = getAttackMapSelectValue(value, coords, userSelectedOption);

  let diagnosticOption: { value: string; label: string } | null = null;
  if (hasValidNum && !GAME_MAP_BY_ID.has(numValue)) {
    diagnosticOption = {
      value: String(numValue),
      label: formatGameMap(numValue),
    };
  }

  const options = [
    { value: ATTACK_SPOT_NONE_SENTINEL, label: "(Không đặt vị trí đánh)" },
    ...(diagnosticOption ? [diagnosticOption] : []),
    ...GAME_MAPS.map((m) => ({
      value: String(m.id),
      label: `[${m.id}] ${m.name}`,
    })),
  ];

  const handleSelectChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const rawVal = e.target.value;
    const nextIntent = rawVal === ATTACK_SPOT_NONE_SENTINEL ? null : rawVal;
    if (onAttackMapIntentChange) {
      onAttackMapIntentChange(nextIntent);
    } else {
      setLocalSelectedOption(nextIntent);
    }
    const { updates } = handleAttackMapSelection(rawVal);
    if (onBatchChange) {
      onBatchChange(updates);
    } else {
      for (const [k, v] of Object.entries(updates)) {
        onChange(k as ConfigPath, v as ConfigValue);
      }
    }
  };

  const currentMap =
    selectValue !== ATTACK_SPOT_NONE_SENTINEL ? getGameMap(Number(selectValue)) : undefined;
  const selectedNotes = currentMap?.notes;

  let effectiveHelp = meta?.help ?? field.help;
  if (selectValue === ATTACK_SPOT_NONE_SENTINEL) {
    effectiveHelp =
      "Chưa đặt vị trí đánh. Chọn map và nhập tọa độ để cấu hình vị trí đánh.";
  } else if (!isConfigured) {
    effectiveHelp = `Map đã chọn [${selectValue}]. Cần nhập tọa độ X và Y hợp lệ (>= 0) bên dưới để kích hoạt vị trí này.`;
  } else if (selectedNotes) {
    effectiveHelp = `${(meta?.help ?? field.help) ? `${meta?.help ?? field.help} · ` : ""}${selectedNotes}`;
  }

  return (
    <SelectField
      id={id}
      label={label}
      help={effectiveHelp}
      error={error}
      options={options}
      value={selectValue}
      disabled={disabled}
      onChange={handleSelectChange}
    />
  );
}

function IconWarning({ className = "size-3.5 shrink-0" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path
        fillRule="evenodd"
        d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 01-1.299 2.25H2.704a1.5 1.5 0 01-1.3-2.25l5.197-9zM8 4a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 4zm0 8a1 1 0 100-2 1 1 0 000 2z"
        clipRule="evenodd"
      />
    </svg>
  );
}

