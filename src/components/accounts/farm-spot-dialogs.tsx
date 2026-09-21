"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TextField } from "@/components/ui/field";
import { formatGameMap } from "@/lib/game-maps";
import type { CreateFarmSpotInput, FarmSpot, FarmSpotSource } from "@/lib/types";
import { validatePresetName } from "@/lib/farm-spots-util";
import { describeError } from "@/services/api";

// ── Save Preset Modal ────────────────────────────────────────────────────────

export interface SavePresetModalProps {
  isOpen: boolean;
  onClose: () => void;
  mapId: number;
  x: number;
  y: number;
  capturedZone: number;
  source: FarmSpotSource;
  existingSpots: readonly FarmSpot[];
  onSave: (input: CreateFarmSpotInput) => Promise<void>;
}

export function SavePresetModal({
  isOpen,
  onClose,
  mapId,
  x,
  y,
  capturedZone,
  source,
  existingSpots,
  onSave,
}: SavePresetModalProps) {
  if (!isOpen) return null;

  return (
    <SavePresetModalContent
      onClose={onClose}
      mapId={mapId}
      x={x}
      y={y}
      capturedZone={capturedZone}
      source={source}
      existingSpots={existingSpots}
      onSave={onSave}
    />
  );
}

function SavePresetModalContent({
  onClose,
  mapId,
  x,
  y,
  capturedZone,
  source,
  existingSpots,
  onSave,
}: Omit<SavePresetModalProps, "isOpen">) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isSubmitting) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSubmitting, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const validation = validatePresetName(name, existingSpots, mapId);
    if (!validation.valid) {
      setError(validation.error ?? "Tên mẫu không hợp lệ");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSave({
        name: validation.normalizedName,
        mapId,
        x,
        y,
        capturedZone: capturedZone >= 0 ? capturedZone : -1,
        source,
      });
      onClose();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-preset-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <Card className="w-full max-w-md p-4 sm:p-5 shadow-xl border-border bg-elevated">
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <h3
              id="save-preset-title"
              className="text-sm font-semibold tracking-tight text-foreground"
            >
              Lưu vị trí thành mẫu
            </h3>
            <p className="mt-1 text-xs text-muted leading-relaxed">
              Lưu vị trí hiện tại vào thư viện mẫu để sử dụng lại cho tài khoản này hoặc tài khoản khác.
            </p>
          </div>

          <div className="mb-4 rounded-md border border-border/70 bg-surface/60 p-3 space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-muted">Bản đồ:</span>
              <span className="font-medium text-foreground">{formatGameMap(mapId)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Tọa độ:</span>
              <span className="font-mono font-medium text-foreground">
                X: {x}, Y: {y}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Khu vực:</span>
              <span className="font-mono text-foreground">
                {capturedZone >= 0 ? `Khu vực ${capturedZone}` : "Chưa ghi nhận (-1)"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted">Nguồn gốc:</span>
              <span className="font-medium text-foreground">
                {source === "detected" ? "Quét phát hiện" : "Thủ công / Vị trí thực"}
              </span>
            </div>
          </div>

          <div className="space-y-3">
            <TextField
              id="preset-name-input"
              label="Tên mẫu vị trí"
              help="Tối đa 48 ký tự, không trùng lặp trên cùng bản đồ."
              required
              autoFocus
              maxLength={48}
              value={name}
              error={error ?? undefined}
              disabled={isSubmitting}
              placeholder="VD: Bãi sói rừng, Bãi nhện tây..."
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
            />
          </div>

          <div className="mt-5 flex items-center justify-end gap-2 border-t border-border/60 pt-3">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isSubmitting}
              onClick={onClose}
            >
              Hủy
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              busy={isSubmitting}
              disabled={isSubmitting || name.trim().length === 0}
            >
              Lưu mẫu
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}

// ── Manage Presets Modal ─────────────────────────────────────────────────────

export interface ManagePresetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentMapId?: number;
  presets: readonly FarmSpot[];
  onSelectPreset?: (spot: FarmSpot) => void;
  onRename: (id: string, newName: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function ManagePresetsModal({
  isOpen,
  onClose,
  currentMapId,
  presets,
  onSelectPreset,
  onRename,
  onDelete,
}: ManagePresetsModalProps) {
  if (!isOpen) return null;

  return (
    <ManagePresetsModalContent
      onClose={onClose}
      currentMapId={currentMapId}
      presets={presets}
      onSelectPreset={onSelectPreset}
      onRename={onRename}
      onDelete={onDelete}
    />
  );
}

function ManagePresetsModalContent({
  onClose,
  currentMapId,
  presets,
  onSelectPreset,
  onRename,
  onDelete,
}: Omit<ManagePresetsModalProps, "isOpen">) {
  const [filterMap, setFilterMap] = useState<number | "all">(
    currentMapId !== undefined && currentMapId >= 0 ? currentMapId : "all",
  );
  const [editingSpotId, setEditingSpotId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !isUpdating && !isDeleting) {
        if (editingSpotId) {
          setEditingSpotId(null);
        } else if (confirmDeleteId) {
          setConfirmDeleteId(null);
        } else {
          onClose();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editingSpotId, confirmDeleteId, isUpdating, isDeleting, onClose]);

  const filteredPresets = presets.filter((spot) => {
    if (filterMap === "all") return true;
    return spot.mapId === filterMap;
  });

  const handleStartRename = (spot: FarmSpot) => {
    setEditingSpotId(spot.id);
    setEditName(spot.name);
    setEditError(null);
    setConfirmDeleteId(null);
  };

  const handleCancelRename = () => {
    setEditingSpotId(null);
    setEditName("");
    setEditError(null);
  };

  const handleSaveRename = async (spot: FarmSpot) => {
    if (isUpdating) return;
    const validation = validatePresetName(editName, presets, spot.mapId, spot.id);
    if (!validation.valid) {
      setEditError(validation.error ?? "Tên không hợp lệ");
      return;
    }

    setIsUpdating(true);
    setEditError(null);
    try {
      await onRename(spot.id, validation.normalizedName);
      setEditingSpotId(null);
    } catch (err) {
      setEditError(describeError(err));
    } finally {
      setIsUpdating(false);
    }
  };

  const handleConfirmDelete = async (id: string) => {
    if (isDeleting) return;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await onDelete(id);
      setConfirmDeleteId(null);
    } catch (err) {
      setDeleteError(describeError(err));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-presets-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isUpdating && !isDeleting) {
          onClose();
        }
      }}
    >
      <Card className="w-full max-w-2xl max-h-[85vh] flex flex-col p-4 sm:p-5 shadow-xl border-border bg-elevated overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border/70 pb-3">
          <div>
            <h3
              id="manage-presets-title"
              className="text-sm font-semibold tracking-tight text-foreground"
            >
              Quản lý mẫu vị trí đánh
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              Đổi tên hoặc xóa các mẫu vị trí đã lưu. Xóa mẫu không ảnh hưởng đến vị trí đang cài đặt.
            </p>
          </div>
          <button
            type="button"
            className="text-muted hover:text-foreground text-sm px-2 py-1 rounded"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-2 py-2.5 border-b border-border/50 text-xs">
          <span className="text-muted">Bộ lọc:</span>
          <button
            type="button"
            className={`px-2.5 py-1 rounded font-medium transition-colors ${
              filterMap === "all"
                ? "bg-accent/20 text-accent border border-accent/30"
                : "bg-surface hover:bg-elevated text-muted border border-border"
            }`}
            onClick={() => setFilterMap("all")}
          >
            Tất cả ({presets.length})
          </button>
          {currentMapId !== undefined && currentMapId >= 0 ? (
            <button
              type="button"
              className={`px-2.5 py-1 rounded font-medium transition-colors ${
                filterMap === currentMapId
                  ? "bg-accent/20 text-accent border border-accent/30"
                  : "bg-surface hover:bg-elevated text-muted border border-border"
              }`}
              onClick={() => setFilterMap(currentMapId)}
            >
              {formatGameMap(currentMapId)} (
              {presets.filter((s) => s.mapId === currentMapId).length})
            </button>
          ) : null}
        </div>

        {/* Delete error alert */}
        {deleteError ? (
          <div className="my-2 rounded border border-danger/40 bg-danger/10 p-2 text-xs text-danger">
            {deleteError}
          </div>
        ) : null}

        {/* List of Presets */}
        <div className="flex-1 overflow-y-auto py-2 space-y-2 pr-1">
          {filteredPresets.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted">
              Chưa có mẫu vị trí nào phù hợp bộ lọc.
            </div>
          ) : (
            filteredPresets.map((spot) => {
              const isRenaming = editingSpotId === spot.id;
              const isConfirmingDelete = confirmDeleteId === spot.id;

              return (
                <div
                  key={spot.id}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-md border border-border/70 bg-surface/70 hover:border-border transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    {isRenaming ? (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            className="flex-1 rounded border border-accent bg-elevated px-2 py-1 text-xs text-foreground focus:outline-none"
                            value={editName}
                            maxLength={48}
                            disabled={isUpdating}
                            autoFocus
                            onChange={(e) => {
                              setEditName(e.target.value);
                              if (editError) setEditError(null);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleSaveRename(spot);
                              }
                            }}
                          />
                          <Button
                            type="button"
                            variant="primary"
                            size="sm"
                            busy={isUpdating}
                            onClick={() => handleSaveRename(spot)}
                          >
                            Lưu
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={isUpdating}
                            onClick={handleCancelRename}
                          >
                            Hủy
                          </Button>
                        </div>
                        {editError ? (
                          <p className="text-[11px] text-danger">{editError}</p>
                        ) : null}
                      </div>
                    ) : (
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-xs text-foreground truncate">
                            {spot.name}
                          </span>
                          <span className="rounded border border-border/60 bg-elevated/60 px-1.5 py-0.2 font-mono text-[10px] text-muted">
                            {spot.source === "detected" ? "Quét" : "Thủ công"}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                          <span>{formatGameMap(spot.mapId)}</span>
                          <span className="font-mono">
                            X: {spot.x}, Y: {spot.y}
                          </span>
                          <span>
                            {spot.capturedZone >= 0
                              ? `Khu vực ${spot.capturedZone}`
                              : "Khu vực: Chưa có"}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  {!isRenaming ? (
                    <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
                      {onSelectPreset ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => {
                            onSelectPreset(spot);
                            onClose();
                          }}
                        >
                          Chọn
                        </Button>
                      ) : null}

                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={isUpdating || isDeleting}
                        onClick={() => handleStartRename(spot)}
                      >
                        Đổi tên
                      </Button>

                      {isConfirmingDelete ? (
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="danger"
                            size="sm"
                            busy={isDeleting}
                            onClick={() => handleConfirmDelete(spot.id)}
                          >
                            Xác nhận xóa
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            disabled={isDeleting}
                            onClick={() => setConfirmDeleteId(null)}
                          >
                            Hủy
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-danger hover:text-danger hover:bg-danger/10"
                          disabled={isUpdating || isDeleting}
                          onClick={() => setConfirmDeleteId(spot.id)}
                        >
                          Xóa
                        </Button>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted">
          <span>Tổng số: {presets.length} mẫu</span>
          <Button type="button" variant="secondary" size="sm" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </Card>
    </div>
  );
}
