"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextField } from "@/components/ui/field";
import { ConfigFieldInput } from "@/components/accounts/config-field";
import { updateLocationWithZoneReset } from "@/lib/attack-spot";
import {
  CONTROL_SCHEMA,
  type ConfigDraft,
  type ConfigErrors,
  type ConfigField,
  type ConfigPath,
  type ConfigValue,
} from "@/lib/config-schema";
import {
  isCurrentPositionAvailable,
  materializeCandidate,
  materializeCurrentPosition,
  materializePreset,
} from "@/lib/farm-spots-util";
import { formatGameMap } from "@/lib/game-maps";
import type {
  Account,
  CreateFarmSpotInput,
  FarmSpot,
  FarmSpotSource,
  SpotScanCandidate,
} from "@/lib/types";
import { describeError } from "@/services/api";
import { useToast } from "@/store/toast-store";
import { useZeusStore } from "@/store/zeus-store";
import {
  ManagePresetsModal,
  SavePresetModal,
} from "@/components/accounts/farm-spot-dialogs";
import { DetectSpotsSection } from "@/components/accounts/detect-spots-section";

export interface AutoFarmPanelProps {
  draft: ConfigDraft;
  persistedDraft?: ConfigDraft;
  errors: ConfigErrors;
  disabled: boolean;
  ctlVersion: number;
  onChange(path: ConfigPath, value: ConfigValue): void;
  onBatchChange?(updates: Partial<Record<ConfigPath, ConfigValue>>): void;
  attackMapIntent?: string | null;
  onAttackMapIntentChange?(intent: string | null): void;
  isActive?: boolean;
  account?: Account;
}

/**
 * Dedicated Auto Farm Configuration Panel (Round 4A & 4B).
 *
 * Information Architecture:
 * 1. farm_behavior: atk.mode, atk.radius, ui.ring
 * 2. farm_location: Saved presets, current position, map, X, Y, zone metadata, detect spots
 * 3. zone_policy:   atk.zoneMode, conditional atk.zonePick
 * 4. loot:          item.rank, item.mphp, item.gold, item.medalDialog, item.dropsOn, item.drops
 *
 * Key Semantics:
 * - Single editable authority for all 15 Auto Farm fields.
 * - Editing map, X, or Y manually normalizes captured metadata atk.zone to -1.
 * - Selecting preset, using current position, or using candidate preserves known captured zone.
 * - Location acquisition actions update draft only (no auto-save, mode preserved).
 * - Presets loaded on-demand only when Auto Farm is active.
 */
export function AutoFarmPanel({
  draft,
  errors,
  disabled,
  ctlVersion,
  onChange,
  onBatchChange,
  attackMapIntent,
  onAttackMapIntentChange,
  isActive = true,
  account,
}: AutoFarmPanelProps) {
  const {
    farmSpots,
    loadFarmSpots,
    createFarmSpot,
    updateFarmSpot,
    deleteFarmSpot,
  } = useZeusStore();
  const { push } = useToast();

  // On-demand preset loading: load presets only when Auto Farm is active
  const hasLoadedPresetsRef = useRef(false);
  useEffect(() => {
    if (isActive && !hasLoadedPresetsRef.current) {
      hasLoadedPresetsRef.current = true;
      loadFarmSpots().catch((err) => {
        push("error", "Tải danh sách mẫu thất bại", describeError(err));
      });
    }
  }, [isActive, loadFarmSpots, push]);

  // Modal states
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [saveTarget, setSaveTarget] = useState<{
    mapId: number;
    x: number;
    y: number;
    capturedZone: number;
    source: FarmSpotSource;
  } | null>(null);
  const [manageModalOpen, setManageModalOpen] = useState(false);

  // Location helpers
  const handleSelectPreset = (spot: FarmSpot) => {
    const updates = materializePreset(spot);
    if (onBatchChange) {
      onBatchChange(updates);
    } else {
      onChange("atk.map", spot.mapId);
      onChange("atk.x", spot.x);
      onChange("atk.y", spot.y);
      onChange("atk.zone", spot.capturedZone ?? -1);
    }
    push("info", "Đã chọn mẫu vị trí", `Đã chọn mẫu "${spot.name}".`);
  };

  const snapshot = account?.snapshot;
  const canUseCurrentPosition = isCurrentPositionAvailable(snapshot);

  const handleUseCurrentPosition = () => {
    if (!snapshot || !canUseCurrentPosition) return;
    const updates = materializeCurrentPosition(snapshot);
    if (onBatchChange) {
      onBatchChange(updates);
    } else {
      onChange("atk.map", snapshot.map);
      onChange("atk.x", snapshot.px);
      onChange("atk.y", snapshot.py);
      onChange("atk.zone", snapshot.zone >= 0 ? snapshot.zone : -1);
    }
    push(
      "info",
      "Đã lấy vị trí hiện tại",
      `Đã sao chép vị trí thực tế của nhân vật (X: ${snapshot.px}, Y: ${snapshot.py}).`,
    );
  };

  const draftMap = Number(draft["atk.map"]);
  const draftX = Number(draft["atk.x"]);
  const draftY = Number(draft["atk.y"]);
  const draftZone = Number(draft["atk.zone"]);
  const canSaveDraftPreset =
    draftMap >= 0 &&
    draftX >= 0 &&
    draftY >= 0 &&
    !Number.isNaN(draftX) &&
    !Number.isNaN(draftY);

  const handleOpenSaveDraftPreset = () => {
    if (!canSaveDraftPreset) return;
    setSaveTarget({
      mapId: draftMap,
      x: draftX,
      y: draftY,
      capturedZone: draftZone >= 0 ? draftZone : -1,
      source: "manual",
    });
    setSaveModalOpen(true);
  };

  const handleUseCandidate = (
    candidate: SpotScanCandidate,
    candidateMapId: number,
    candidateZone: number,
  ) => {
    const updates = materializeCandidate(candidateMapId, candidateZone, candidate);
    if (onBatchChange) {
      onBatchChange(updates);
    } else {
      onChange("atk.map", candidateMapId);
      onChange("atk.x", candidate.x);
      onChange("atk.y", candidate.y);
      onChange("atk.zone", candidateZone);
    }
    push(
      "info",
      "Đã chọn bãi quái",
      `Đã áp dụng tọa độ ${candidate.mobName || "quái vật"} (X: ${candidate.x}, Y: ${candidate.y}).`,
    );
  };

  const handleSaveCandidatePreset = (
    candidate: SpotScanCandidate,
    candidateMapId: number,
    candidateZone: number,
  ) => {
    setSaveTarget({
      mapId: candidateMapId,
      x: candidate.x,
      y: candidate.y,
      capturedZone: candidateZone,
      source: "detected",
    });
    setSaveModalOpen(true);
  };

  const handleSavePresetSubmit = async (input: CreateFarmSpotInput) => {
    await createFarmSpot(input);
    push("success", "Đã lưu mẫu vị trí", `Mẫu "${input.name}" đã được lưu thành công.`);
  };

  const handleRenamePreset = async (id: string, newName: string) => {
    await updateFarmSpot(id, { name: newName });
    push("success", "Đã đổi tên mẫu", `Mẫu vị trí đã đổi tên thành "${newName}".`);
  };

  const handleDeletePreset = async (id: string) => {
    await deleteFarmSpot(id);
    push("success", "Đã xóa mẫu vị trí", "Mẫu vị trí đã được xóa khỏi thư viện.");
  };
  const sections = CONTROL_SCHEMA[ctlVersion] ?? [];
  const autoFarmSection = sections.find((s) => s.id === "auto_farm");
  const fieldsByPath = new Map<ConfigPath, ConfigField>(
    autoFarmSection?.fields.map((f) => [f.path, f]) ?? [],
  );

  const getField = (path: ConfigPath): ConfigField | undefined => fieldsByPath.get(path);

  // Field descriptors
  const modeField = getField("atk.mode");
  const radiusField = getField("atk.radius");
  const ringField = getField("ui.ring");
  const mapField = getField("atk.map");
  const zoneModeField = getField("atk.zoneMode");
  const zonePickField = getField("atk.zonePick");
  const itemRankField = getField("item.rank");
  const itemMphpField = getField("item.mphp");
  const itemGoldField = getField("item.gold");
  const itemMedalDialogField = getField("item.medalDialog");
  const itemDropsOnField = getField("item.dropsOn");
  const itemDropsField = getField("item.drops");

  const modeVal = Number(draft["atk.mode"]);
  const isAutoFarmActive = modeVal === 1 || modeVal === 2;
  const isZonePickVisible = Number(draft["atk.zoneMode"]) === 2;

  function handleCoordChange(axis: "atk.x" | "atk.y", rawVal: string) {
    const nextVal = rawVal === "" ? "" : Number(rawVal);
    if (onBatchChange) {
      onBatchChange(updateLocationWithZoneReset(axis, nextVal));
    } else {
      onChange(axis, nextVal);
      onChange("atk.zone", -1);
    }
  }

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* ── 1. farm_behavior ────────────────────────────────────────────── */}
      <Card id="subcard-farm-behavior" className="overflow-hidden border border-border bg-surface shadow-xs">
        <div className="border-b border-border/70 bg-elevated/40 px-4 py-2.5 sm:px-5">
          <div className="flex items-center gap-2">
            <IconSwords className="size-4 text-muted" />
            <h4 className="text-sm font-semibold tracking-tight text-foreground">
              Hành vi tấn công
            </h4>
            {isAutoFarmActive ? (
              <span className="rounded border border-accent/35 bg-accent/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-accent">
                {modeVal === 1 ? "Đứng yên" : "Di chuyển"}
              </span>
            ) : (
              <span className="rounded border border-border bg-elevated/60 px-2 py-0.5 font-mono text-[10px] font-medium text-muted">
                Tắt
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Chế độ tự đánh và bán kính phạm vi chiến đấu quanh vị trí.
          </p>
        </div>

        <div className="divide-y divide-border/40 px-4 sm:px-5">
          {modeField ? (
            <div className="py-2.5 first:pt-2.5 last:pb-2.5">
              <ConfigFieldInput
                field={modeField}
                value={draft["atk.mode"] ?? 0}
                values={draft}
                error={errors["atk.mode"]}
                disabled={disabled}
                onChange={onChange}
                onBatchChange={onBatchChange}
              />
            </div>
          ) : null}

          {radiusField ? (
            <div className="py-2.5 first:pt-2.5 last:pb-2.5">
              <ConfigFieldInput
                field={radiusField}
                value={draft["atk.radius"] ?? 120}
                values={draft}
                error={errors["atk.radius"]}
                disabled={disabled}
                onChange={onChange}
                onBatchChange={onBatchChange}
              />
            </div>
          ) : null}

          {ringField ? (
            <div className="py-2.5 first:pt-2.5 last:pb-2.5">
              <ConfigFieldInput
                field={ringField}
                value={draft["ui.ring"] ?? 0}
                values={draft}
                error={errors["ui.ring"]}
                disabled={disabled}
                onChange={onChange}
                onBatchChange={onBatchChange}
              />
            </div>
          ) : null}
        </div>
      </Card>

      {/* ── 2. farm_location ────────────────────────────────────────────── */}
      <Card id="subcard-farm-location" className="overflow-hidden border border-border bg-surface shadow-xs">
        <div className="border-b border-border/70 bg-elevated/40 px-4 py-2.5 sm:px-5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <IconPin className="size-4 text-muted" />
              <h4 className="text-sm font-semibold tracking-tight text-foreground">
                Vị trí đánh
              </h4>
            </div>
            <span className="text-[11px] font-medium text-muted">
              Vị trí đánh hiện tại
            </span>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Thiết lập map và tọa độ X, Y bãi đánh của nhân vật.
          </p>
        </div>

        {/* Preset & Telemetry Toolbar */}
        <div className="border-b border-border/50 bg-elevated/20 p-3 sm:px-5">
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            {/* Preset Selector */}
            <div className="flex flex-1 items-center gap-2 min-w-0">
              <label
                htmlFor="farm-preset-select"
                className="shrink-0 text-xs font-medium text-muted"
              >
                Mẫu đã lưu:
              </label>
              <select
                id="farm-preset-select"
                className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-accent focus:outline-none disabled:opacity-50"
                disabled={disabled || farmSpots.length === 0}
                value=""
                onChange={(e) => {
                  const selectedId = e.target.value;
                  if (!selectedId) return;
                  const spot = farmSpots.find((s) => s.id === selectedId);
                  if (spot) handleSelectPreset(spot);
                }}
              >
                <option value="">
                  {farmSpots.length === 0
                    ? "— Chưa có mẫu vị trí nào —"
                    : `— Chọn từ mẫu đã lưu (${farmSpots.length}) —`}
                </option>
                {farmSpots.map((spot) => (
                  <option key={spot.id} value={spot.id}>
                    {formatGameMap(spot.mapId)}: {spot.name} (X: {spot.x}, Y: {spot.y}
                    {spot.capturedZone >= 0 ? `, K.${spot.capturedZone}` : ""})
                  </option>
                ))}
              </select>
            </div>

            {/* Quick Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="text-xs"
                disabled={disabled || !canUseCurrentPosition}
                onClick={handleUseCurrentPosition}
                title={
                  !canUseCurrentPosition
                    ? "Chưa có tọa độ nhân vật từ game"
                    : "Lấy tọa độ hiện tại của nhân vật trong game"
                }
              >
                Vị trí hiện tại
              </Button>

              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="text-xs"
                disabled={disabled || !canSaveDraftPreset}
                onClick={handleOpenSaveDraftPreset}
                title={
                  !canSaveDraftPreset
                    ? "Cần có bản đồ và tọa độ X, Y hợp lệ để lưu mẫu"
                    : "Lưu vị trí hiện tại thành mẫu"
                }
              >
                Lưu mẫu
              </Button>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-xs"
                disabled={disabled}
                onClick={() => setManageModalOpen(true)}
              >
                Quản lý mẫu
              </Button>
            </div>
          </div>
        </div>

        <div className="divide-y divide-border/40 px-4 sm:px-5">
          {mapField ? (
            <div className="py-2.5 first:pt-2.5 last:pb-2.5">
              <ConfigFieldInput
                field={mapField}
                value={draft["atk.map"] ?? 0}
                values={draft}
                error={errors["atk.map"]}
                disabled={disabled}
                onChange={onChange}
                onBatchChange={onBatchChange}
                attackMapIntent={attackMapIntent}
                onAttackMapIntentChange={onAttackMapIntentChange}
              />
            </div>
          ) : null}

          {/* Coordinates X & Y */}
          <div className="py-2.5 first:pt-2.5 last:pb-2.5">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <TextField
                id="cfg-atk-x"
                label="Tọa độ X"
                help="Tọa độ X trong game (pixel). -1 = chưa đặt vị trí."
                error={errors["atk.x"]}
                type="number"
                inputMode="numeric"
                min={-1}
                max={2147483647}
                disabled={disabled}
                value={draft["atk.x"] !== undefined ? String(draft["atk.x"]) : ""}
                onChange={(e) => handleCoordChange("atk.x", e.target.value)}
              />
              <TextField
                id="cfg-atk-y"
                label="Tọa độ Y"
                help="Tọa độ Y trong game (pixel). -1 = chưa đặt vị trí."
                error={errors["atk.y"]}
                type="number"
                inputMode="numeric"
                min={-1}
                max={2147483647}
                disabled={disabled}
                value={draft["atk.y"] !== undefined ? String(draft["atk.y"]) : ""}
                onChange={(e) => handleCoordChange("atk.y", e.target.value)}
              />
            </div>
          </div>

          {/* Read-only Captured Zone Metadata */}
          <div className="py-2.5 first:pt-2.5 last:pb-2.5">
            <div className="rounded-md border border-border/70 bg-elevated/30 p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">
                  Khu vực đã lưu (Metadata)
                </span>
                <span className="rounded border border-border bg-surface px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted">
                  Chỉ đọc
                </span>
              </div>
              <p className="mt-1 font-mono text-sm font-semibold text-foreground">
                {Number(draft["atk.zone"]) >= 0
                  ? `Khu vực ${draft["atk.zone"]}`
                  : "Chưa ghi nhận (-1)"}
              </p>
              <p className="mt-1 text-[11px] text-muted leading-relaxed">
                Khu vực này do game ghi nhận tại vị trí đánh. Khi bạn chỉnh sửa Map hoặc tọa độ X/Y thủ công, giá trị này sẽ tự động đặt lại về -1.
              </p>
            </div>
          </div>

          {/* Detect Spots Section */}
          {account ? (
            <div className="py-3 first:pt-2.5 last:pb-3">
              <DetectSpotsSection
                account={account}
                disabled={disabled}
                onUseCandidate={handleUseCandidate}
                onSaveCandidatePreset={handleSaveCandidatePreset}
              />
            </div>
          ) : null}
        </div>
      </Card>

      {/* ── 3. zone_policy ──────────────────────────────────────────────── */}
      <Card id="subcard-zone-policy" className="overflow-hidden border border-border bg-surface shadow-xs">
        <div className="border-b border-border/70 bg-elevated/40 px-4 py-2.5 sm:px-5">
          <div className="flex items-center gap-2">
            <IconCompass className="size-4 text-muted" />
            <h4 className="text-sm font-semibold tracking-tight text-foreground">
              Chính sách khu vực
            </h4>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Quy tắc chọn hoặc chuyển đổi khu vực khi nhân vật đến bãi đánh.
          </p>
        </div>

        <div className="divide-y divide-border/40 px-4 sm:px-5">
          {zoneModeField ? (
            <div className="py-2.5 first:pt-2.5 last:pb-2.5">
              <ConfigFieldInput
                field={zoneModeField}
                value={draft["atk.zoneMode"] ?? 0}
                values={draft}
                error={errors["atk.zoneMode"]}
                disabled={disabled}
                onChange={onChange}
                onBatchChange={onBatchChange}
              />
            </div>
          ) : null}

          {/* Conditional zonePick: only visible when zoneMode is Pick (2) */}
          {isZonePickVisible && zonePickField ? (
            <div className="py-2.5 first:pt-2.5 last:pb-2.5">
              <ConfigFieldInput
                field={zonePickField}
                value={draft["atk.zonePick"] ?? 1}
                values={draft}
                error={errors["atk.zonePick"]}
                disabled={disabled}
                onChange={onChange}
                onBatchChange={onBatchChange}
              />
            </div>
          ) : null}
        </div>
      </Card>

      {/* ── 4. loot ─────────────────────────────────────────────────────── */}
      <Card id="subcard-loot" className="overflow-hidden border border-border bg-surface shadow-xs">
        <div className="border-b border-border/70 bg-elevated/40 px-4 py-2.5 sm:px-5">
          <div className="flex items-center gap-2">
            <IconBag className="size-4 text-muted" />
            <h4 className="text-sm font-semibold tracking-tight text-foreground">
              Nhặt vật phẩm
            </h4>
          </div>
          <p className="mt-0.5 text-xs text-muted">
            Bộ lọc nhặt trang bị, bình hồi phục, vàng và đóng hòm đồ (hoạt động độc lập với chế độ tự đánh).
          </p>
        </div>

        <div className="divide-y divide-border/40 px-4 sm:px-5">
          {itemRankField ? (
            <div className="py-2.5 first:pt-2.5 last:pb-2.5">
              <ConfigFieldInput
                field={itemRankField}
                value={draft["item.rank"] ?? 0}
                values={draft}
                error={errors["item.rank"]}
                disabled={disabled}
                onChange={onChange}
                onBatchChange={onBatchChange}
              />
            </div>
          ) : null}

          {itemMphpField ? (
            <div className="py-2.5 first:pt-2.5 last:pb-2.5">
              <ConfigFieldInput
                field={itemMphpField}
                value={draft["item.mphp"] ?? 0}
                values={draft}
                error={errors["item.mphp"]}
                disabled={disabled}
                onChange={onChange}
                onBatchChange={onBatchChange}
              />
            </div>
          ) : null}

          {itemGoldField ? (
            <div className="py-2.5 first:pt-2.5 last:pb-2.5">
              <ConfigFieldInput
                field={itemGoldField}
                value={draft["item.gold"] ?? 0}
                values={draft}
                error={errors["item.gold"]}
                disabled={disabled}
                onChange={onChange}
                onBatchChange={onBatchChange}
              />
            </div>
          ) : null}

          {itemMedalDialogField ? (
            <div className="py-2.5 first:pt-2.5 last:pb-2.5">
              <ConfigFieldInput
                field={itemMedalDialogField}
                value={draft["item.medalDialog"] ?? 0}
                values={draft}
                error={errors["item.medalDialog"]}
                disabled={disabled}
                onChange={onChange}
                onBatchChange={onBatchChange}
              />
            </div>
          ) : null}

          {itemDropsOnField ? (
            <div className="py-2.5 first:pt-2.5 last:pb-2.5">
              <ConfigFieldInput
                field={itemDropsOnField}
                value={draft["item.dropsOn"] ?? 0}
                values={draft}
                error={errors["item.dropsOn"]}
                disabled={disabled}
                onChange={onChange}
                onBatchChange={onBatchChange}
              />
            </div>
          ) : null}

          {itemDropsField ? (
            <div className="py-2.5 first:pt-2.5 last:pb-2.5">
              <ConfigFieldInput
                field={itemDropsField}
                value={draft["item.drops"] ?? "000000"}
                values={draft}
                error={errors["item.drops"]}
                disabled={disabled}
                onChange={onChange}
                onBatchChange={onBatchChange}
              />
            </div>
          ) : null}
        </div>
      </Card>

      {/* Preset Dialogs */}
      {saveTarget ? (
        <SavePresetModal
          isOpen={saveModalOpen}
          onClose={() => {
            setSaveModalOpen(false);
            setSaveTarget(null);
          }}
          mapId={saveTarget.mapId}
          x={saveTarget.x}
          y={saveTarget.y}
          capturedZone={saveTarget.capturedZone}
          source={saveTarget.source}
          existingSpots={farmSpots}
          onSave={handleSavePresetSubmit}
        />
      ) : null}

      <ManagePresetsModal
        isOpen={manageModalOpen}
        onClose={() => setManageModalOpen(false)}
        currentMapId={draftMap >= 0 ? draftMap : undefined}
        presets={farmSpots}
        onSelectPreset={handleSelectPreset}
        onRename={handleRenamePreset}
        onDelete={handleDeletePreset}
      />
    </div>
  );
}

// ── Icons ────────────────────────────────────────────────────────────────────

function IconSwords({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path
        d="M14.5 1.5l-6.5 6.5M11 1.5l3.5 3.5M6.5 9.5l-2.5 2.5-2.5.5.5-2.5 2.5-2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M1.5 1.5l6.5 6.5M5 1.5l-3.5 3.5M9.5 9.5l2.5 2.5 2.5.5-.5-2.5-2.5-2.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconPin({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1" />
      <path
        d="M8 1v2.5M8 12.5V15M1 8h2.5M12.5 8H15"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <circle cx="8" cy="8" r="0.8" fill="currentColor" />
    </svg>
  );
}

function IconCompass({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.2" />
      <polygon points="8,2.5 10,8 8,6.8 6,8" fill="currentColor" />
      <polygon
        points="8,13.5 10,8 8,9.2 6,8"
        stroke="currentColor"
        strokeWidth="0.8"
        fill="currentColor"
        fillOpacity="0.25"
      />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
    </svg>
  );
}

function IconBag({ className = "size-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" aria-hidden="true">
      <path d="M6 3.5c-.5-1.2 1-2 2-2s2.5.8 2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <rect x="5" y="3.5" width="6" height="1.5" rx="0.5" fill="currentColor" fillOpacity="0.4" stroke="currentColor" strokeWidth="0.8" />
      <path d="M5 5C3 6 2 8 2 11a4 4 0 0 0 4 4h4a4 4 0 0 0 4-4c0-3-1-5-3-6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="10.5" r="1.5" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}
