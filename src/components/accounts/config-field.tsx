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
  NO_ATTACK_SPOT_LABEL,
  getAttackMapSelectValue,
  handleAttackMapSelection,
  isAttackSpotConfigured,
} from "@/lib/attack-spot";
import { SelectField, TextField, ToggleField } from "@/components/ui/field";

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
  const id = `cfg-${field.path.replace(/\./g, "-")}`;
  const set = (next: ConfigValue) => onChange(field.path, next);

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
        label={field.label}
        help={field.help}
        checked={value === true || value === 1 || value === "1"}
        disabled={disabled}
        onChange={(next) => set(next ? 1 : 0)}
      />
    );
  }

  if (field.type === "select") {
    return (
      <SelectField
        id={id}
        label={(field as ConfigFieldSelect).label}
        help={field.help}
        error={error}
        options={(field as ConfigFieldSelect).options.map((o) => ({
          value: String(o.value),
          label: o.label,
        }))}
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
            label: `Unsupported destination [${numValue}] ${catalogMap.name}`,
          };
        } else {
          diagnosticOption = {
            value: String(numValue),
            label: `Unknown destination [${numValue}]`,
          };
        }
      }
    }

    const options = [
      { value: "-1", label: "Off" },
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
      ? `${field.help ? `${field.help} · ` : ""}${selectedNotes}`
      : field.help;

    return (
      <SelectField
        id={id}
        label={field.label}
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
      ? `${field.help ? `${field.help} · ` : ""}${selectedNotes}`
      : field.help;

    return (
      <SelectField
        id={id}
        label={field.label}
        help={effectiveHelp}
        error={error}
        options={options}
        value={hasValidNum ? String(numValue) : "0"}
        disabled={disabled}
        onChange={(e) => set(Number(e.target.value))}
      />
    );
  }

  if (field.type === "flags") {
    const f = field as ConfigFieldFlags;
    const str = String(value ?? "").padEnd(f.length, "0");
    return (
      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-muted">{f.label}</span>
        {f.help ? <p className="text-xs text-muted/80">{f.help}</p> : null}
        <div className="flex flex-wrap gap-x-6 gap-y-2">
          {f.bitLabels.map((bitLabel, i) => (
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
            <span aria-hidden="true">⚠</span>
            <span>{error}</span>
          </p>
        ) : null}
      </div>
    );
  }

  if (field.type === "action") {
    const f = field as ConfigFieldAction;
    const armed = value === 1 || value === true || value === "1";
    return (
      <div className="space-y-1.5">
        <span className="block text-xs font-medium text-muted">{f.label}</span>
        {f.help ? <p className="text-xs text-muted/80">{f.help}</p> : null}
        <button
          id={id}
          type="button"
          disabled={disabled || armed}
          onClick={() => set(1)}
          className="inline-flex min-h-[36px] items-center rounded-md border border-border bg-elevated px-4 text-xs font-semibold uppercase tracking-wider text-foreground transition-colors hover:border-accent/40 hover:bg-elevated/80 disabled:opacity-50"
        >
          {armed ? "Queued…" : f.buttonLabel}
        </button>
        {error ? (
          <p className="text-xs font-medium text-danger flex items-center gap-1">
            <span aria-hidden="true">⚠</span>
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
      label={field.label}
      help={field.help}
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
    { value: ATTACK_SPOT_NONE_SENTINEL, label: NO_ATTACK_SPOT_LABEL },
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

  let effectiveHelp = field.help;
  if (selectValue === ATTACK_SPOT_NONE_SENTINEL) {
    effectiveHelp =
      "No attack spot configured. Select a map and set coordinates to configure an attack spot.";
  } else if (!isConfigured) {
    effectiveHelp = `Selected map [${selectValue}]. Set valid X and Y coordinates (>= 0) below to activate this spot.`;
  } else if (selectedNotes) {
    effectiveHelp = `${field.help ? `${field.help} · ` : ""}${selectedNotes}`;
  }

  return (
    <SelectField
      id={id}
      label={field.label}
      help={effectiveHelp}
      error={error}
      options={options}
      value={selectValue}
      disabled={disabled}
      onChange={handleSelectChange}
    />
  );
}
