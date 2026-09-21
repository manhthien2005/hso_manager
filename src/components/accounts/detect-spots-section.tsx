"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Spinner } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  correlateScanResult,
  DETECT_SPOTS_TIMEOUT_MS,
  isRetainedScanFresh,
} from "@/lib/farm-spots-util";
import { formatGameMap } from "@/lib/game-maps";
import type {
  Account,
  SpotScanCandidate,
  SpotScanSnapshot,
} from "@/lib/types";
import { describeError } from "@/services/api";
import { useZeusStore } from "@/store/zeus-store";

export interface DetectSpotsSectionProps {
  account: Account;
  disabled: boolean;
  onUseCandidate: (
    candidate: SpotScanCandidate,
    mapId: number,
    capturedZone: number,
  ) => void;
  onSaveCandidatePreset: (
    candidate: SpotScanCandidate,
    mapId: number,
    capturedZone: number,
  ) => void;
}

export function DetectSpotsSection({
  account,
  disabled,
  onUseCandidate,
  onSaveCandidatePreset,
}: DetectSpotsSectionProps) {
  const { detectSpots } = useZeusStore();

  // Local-only state for live pending scan
  const [livePendingScanId, setLivePendingScanId] = useState<string | null>(null);
  const [localTimeoutNotice, setLocalTimeoutNotice] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCallingApi, setIsCallingApi] = useState(false);

  const timeoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const snapshot = account.snapshot;
  const runtimeMap = snapshot?.map ?? -1;
  const rawScan = snapshot?.spotScan;

  // Correlation logic:
  const correlation = correlateScanResult(livePendingScanId, rawScan);
  const isLivePending = (livePendingScanId !== null && correlation.isPending) || isCallingApi;
  const isLiveScanResolved = livePendingScanId !== null && correlation.isMatched && !correlation.isPending;

  // Clear local timeout timer if scan resolved
  useEffect(() => {
    if (isLiveScanResolved && timeoutTimerRef.current) {
      clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = null;
    }
  }, [isLiveScanResolved]);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timeoutTimerRef.current) {
        clearTimeout(timeoutTimerRef.current);
      }
    };
  }, []);

  const [dismissedNotice, setDismissedNotice] = useState(false);

  const handleStartScan = async () => {
    if (isLivePending || isCallingApi || disabled) return;

    setIsCallingApi(true);
    setErrorMessage(null);
    setLocalTimeoutNotice(null);
    setDismissedNotice(false);

    try {
      const cmd = await detectSpots(account.id);
      setLivePendingScanId(cmd.id);

      // Start local timeout timer
      if (timeoutTimerRef.current) clearTimeout(timeoutTimerRef.current);
      timeoutTimerRef.current = setTimeout(() => {
        setLivePendingScanId((current) => {
          if (current === cmd.id) {
            setLocalTimeoutNotice(
              `Quá thời gian chờ phản hồi từ game (${DETECT_SPOTS_TIMEOUT_MS / 1000}s). Bạn có thể thử lại.`,
            );
            return null;
          }
          return current;
        });
      }, DETECT_SPOTS_TIMEOUT_MS);
    } catch (err) {
      setErrorMessage(describeError(err));
    } finally {
      setIsCallingApi(false);
    }
  };

  // Determine active scan result to display
  let activeScan: SpotScanSnapshot | null = null;
  if (livePendingScanId !== null) {
    if (correlation.isMatched && correlation.result) {
      activeScan = correlation.result;
    }
  } else {
    // Retained scan when no active live request
    if (isRetainedScanFresh(rawScan, runtimeMap >= 0 ? runtimeMap : undefined)) {
      activeScan = rawScan ?? null;
    }
  }

  // Derive status feedback for matched completed/timeout/error scan
  const runtimeTimeout = correlation.isMatched && correlation.result?.status === "timeout"
    ? "Quá trình quét quái từ game bị quá hạn (timeout)."
    : null;
  const runtimeError = correlation.isMatched && correlation.result?.status === "error"
    ? "Có lỗi xảy ra trong quá trình quét quái vật từ game."
    : null;
  const displayTimeoutNotice = dismissedNotice ? null : (localTimeoutNotice ?? runtimeTimeout);
  const displayErrorMessage = dismissedNotice ? null : (errorMessage ?? runtimeError);

  // Account readiness to attempt a scan
  const isAccountRunning = account.status === "running" || snapshot !== null;
  const canScan = isAccountRunning && !disabled && !isLivePending && !isCallingApi;

  return (
    <div className="space-y-3 pt-2">
      {/* Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-foreground">
              Phát hiện bãi quái (Detect Spots)
            </span>
            {isLivePending ? (
              <span className="inline-flex items-center gap-1 rounded border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
                <Spinner className="size-2.5" />
                Đang quét...
              </span>
            ) : null}
          </div>
          <p className="text-[11px] text-muted">
            Quét các cụm quái vật xung quanh vị trí nhân vật trong game để chọn bãi nhanh.
          </p>
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!canScan}
          busy={isLivePending || isCallingApi}
          onClick={handleStartScan}
          title={
            !isAccountRunning
              ? "Tài khoản cần đang chạy trong game để có thể quét bãi quái"
              : undefined
          }
        >
          {isLivePending ? "Đang quét..." : "Quét tìm quái"}
        </Button>
      </div>

      {/* Local Timeout Notice */}
      {displayTimeoutNotice ? (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-200">
          <div className="flex items-start justify-between gap-2">
            <span>{displayTimeoutNotice}</span>
            <button
              type="button"
              className="text-amber-300 hover:text-amber-100 text-xs shrink-0"
              onClick={() => {
                setLocalTimeoutNotice(null);
                setDismissedNotice(true);
              }}
            >
              Đóng
            </button>
          </div>
        </div>
      ) : null}

      {/* Error Notice */}
      {displayErrorMessage ? (
        <div className="rounded-md border border-danger/40 bg-danger/10 p-2.5 text-xs text-danger">
          <div className="flex items-start justify-between gap-2">
            <span>{displayErrorMessage}</span>
            <button
              type="button"
              className="text-danger hover:text-danger/80 text-xs shrink-0"
              onClick={() => {
                setErrorMessage(null);
                setDismissedNotice(true);
              }}
            >
              Đóng
            </button>
          </div>
        </div>
      ) : null}

      {/* Content Area */}
      {isLivePending ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-border/70 bg-elevated/40 p-6 text-center">
          <Spinner className="size-6 text-accent mb-2" />
          <p className="text-xs font-medium text-foreground">
            Đang quét tìm các cụm quái vật trong game...
          </p>
          <p className="text-[11px] text-muted mt-1">
            Lệnh đã gửi tới agent, vui lòng chờ trong giây lát (tối đa 5s).
          </p>
        </div>
      ) : activeScan ? (
        <div className="space-y-2">
          {activeScan.status === "empty" || !activeScan.candidates || activeScan.candidates.length === 0 ? (
            <div className="rounded-md border border-border/70 bg-surface/50 p-4 text-center">
              <p className="text-xs text-muted">
                Không phát hiện thấy cụm quái vật nào trong phạm vi quét xung quanh.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-muted">
                <span>
                  Tìm thấy {activeScan.candidates.length} cụm quái (
                  {formatGameMap(activeScan.mapId ?? runtimeMap)}
                  {activeScan.capturedZone !== undefined && activeScan.capturedZone >= 0
                    ? `, Khu vực ${activeScan.capturedZone}`
                    : ""}
                  ):
                </span>
                {activeScan.detectedAt ? (
                  <span>
                    Quét lúc: {new Date(activeScan.detectedAt).toLocaleTimeString()}
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {activeScan.candidates.map((candidate, idx) => {
                  const candidateMapId = activeScan?.mapId ?? runtimeMap;
                  const candidateZone = activeScan?.capturedZone ?? -1;

                  return (
                    <Card
                      key={`${candidate.x}-${candidate.y}-${idx}`}
                      className="p-3 border-border/80 bg-surface/80 hover:border-accent/50 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-semibold text-xs text-foreground truncate">
                              {candidate.mobName || "Quái vật"}
                            </span>
                            {candidate.mobLevel > 0 ? (
                              <span className="rounded bg-elevated px-1 py-0.2 text-[10px] font-mono text-muted">
                                Lv.{candidate.mobLevel}
                              </span>
                            ) : null}
                          </div>
                          <div className="mt-1 flex flex-wrap gap-x-2 text-[11px] text-muted">
                            <span className="font-mono text-foreground font-medium">
                              {candidate.mobCount} con
                            </span>
                            <span className="font-mono">
                              X: {candidate.x}, Y: {candidate.y}
                            </span>
                            {candidate.spreadRadius > 0 ? (
                              <span>Bán kính: {candidate.spreadRadius}px</span>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex flex-col gap-1 shrink-0">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="text-[11px] h-7 px-2.5"
                            disabled={disabled}
                            onClick={() =>
                              onUseCandidate(candidate, candidateMapId, candidateZone)
                            }
                          >
                            Sử dụng
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-[11px] h-7 px-2.5 text-muted hover:text-foreground"
                            disabled={disabled}
                            onClick={() =>
                              onSaveCandidatePreset(
                                candidate,
                                candidateMapId,
                                candidateZone,
                              )
                            }
                          >
                            Lưu mẫu
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-md border border-dashed border-border/70 bg-surface/30 p-3 text-center">
          <p className="text-[11px] text-muted">
            Chưa có dữ liệu quét bãi quái. Nhấn &quot;Quét tìm quái&quot; để tìm các cụm quái gần nhân vật.
          </p>
        </div>
      )}
    </div>
  );
}
