"use client";

import type {
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
  error,
  disabled,
  onChange,
}: {
  field: ConfigField;
  value: ConfigValue;
  error?: string;
  disabled?: boolean;
  onChange(path: ConfigPath, value: ConfigValue): void;
}) {
  const id = `cfg-${field.path.replace(/\./g, "-")}`;
  const set = (next: ConfigValue) => onChange(field.path, next);

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
        {error ? <p className="text-xs text-danger">{error}</p> : null}
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
          className="inline-flex h-9 items-center rounded-md border border-border bg-elevated px-4 text-sm font-medium text-foreground transition-colors hover:bg-elevated/80 disabled:opacity-50"
        >
          {armed ? "Queued…" : f.buttonLabel}
        </button>
        {error ? <p className="text-xs text-danger">{error}</p> : null}
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
