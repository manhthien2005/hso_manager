"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import { ACCOUNT_STATUS_LABELS } from "@/components/ui/status";
import {
  isCharacterSlotAvailableOnDevice,
  isValidCharacterSlot,
  validateCharacterSlotSelection,
} from "@/lib/capabilities";
import { CONTROL_SCHEMA } from "@/lib/config-schema";
import { SERVER_OPTIONS } from "@/lib/game-servers";
import type { Account, CharacterSlot, Device } from "@/lib/types";
import { describeError, isApiError } from "@/services/api";
import { useToast } from "@/store/toast-store";
import { useZeusStore } from "@/store/zeus-store";

type SubmitMode = "create" | "create-start" | null;

interface CreateAccountFormProps {
  device: Device;
  onClose?: () => void;
  onSubmittingChange?: (submitting: boolean) => void;
}

export function CreateAccountForm({
  device,
  onClose,
  onSubmittingChange,
}: CreateAccountFormProps) {
  const { devices, createAccount, runCommand } = useZeusStore();
  const { push } = useToast();

  const activeDevice = devices.find((d) => d.deviceId === device.deviceId) ?? device;
  const isSlotCapable = isCharacterSlotAvailableOnDevice(activeDevice);

  const [label, setLabel] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [serverIndex, setServerIndex] = useState(0);
  const [characterSlot, setCharacterSlot] = useState<CharacterSlot>(1);

  const [submitMode, setSubmitMode] = useState<SubmitMode>(null);
  const [errors, setErrors] = useState<{
    label?: string;
    username?: string;
    password?: string;
    serverIndex?: string;
    characterSlot?: string;
  }>({});

  const ctlVersion = device.jar_ctl_version;
  const hasReportedCtl = ctlVersion !== null;
  const isCtlSupported =
    hasReportedCtl && Boolean(CONTROL_SCHEMA[ctlVersion]);
  const isOnline = device.status === "online";
  const isSubmitting = submitMode !== null;

  let ctlWarning: string | null = null;
  if (!hasReportedCtl) {
    ctlWarning = "Máy chủ chưa báo cáo phiên bản Control.";
  } else if (!isCtlSupported) {
    ctlWarning = `Máy chủ báo cáo phiên bản Control không được hỗ trợ (${ctlVersion}).`;
  }

  const canCreateOnly = isCtlSupported && !isSubmitting;
  const canCreateAndStart = isCtlSupported && isOnline && !isSubmitting;

  const handleSubmit = async (mode: "create" | "create-start") => {
    if (submitMode !== null) return;

    if (!isCtlSupported) return;
    if (mode === "create-start" && !isOnline) return;

    const newErrors: {
      label?: string;
      username?: string;
      password?: string;
      serverIndex?: string;
      characterSlot?: string;
    } = {};

    if (label.trim().length === 0) {
      newErrors.label = "Tên hiển thị tài khoản không được để trống";
    }
    if (username.trim().length === 0) {
      newErrors.username = "Tên đăng nhập không được để trống";
    }
    if (password.length === 0) {
      newErrors.password = "Mật khẩu không được để trống";
    }
    if (
      typeof serverIndex !== "number" ||
      !Number.isInteger(serverIndex) ||
      !SERVER_OPTIONS.some((server) => server.value === serverIndex)
    ) {
      newErrors.serverIndex = "Vui lòng chọn một máy chủ game hợp lệ";
    }

    const currentDevice = devices.find((d) => d.deviceId === device.deviceId) ?? activeDevice;
    const currentCapable = isCharacterSlotAvailableOnDevice(currentDevice);
    const slotError = validateCharacterSlotSelection(characterSlot, currentCapable);
    if (slotError) {
      newErrors.characterSlot = slotError;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    setSubmitMode(mode);
    onSubmittingChange?.(true);

    let createdAccount: Account | null = null;
    try {
      createdAccount = await createAccount({
        deviceId: device.deviceId,
        label: label.trim(),
        username,
        password,
        serverIndex,
        character_slot: characterSlot,
      });
    } catch (error) {
      // Clear password on failure to minimize sensitive lifetime
      setPassword("");
      setSubmitMode(null);
      onSubmittingChange?.(false);

      let message = describeError(error);
      if (isApiError(error) && error.code === "FETCH_ACCOUNT") {
        message = `${message}. Vui lòng làm mới hoặc kiểm tra danh sách tài khoản trước khi thử lại.`;
      }
      push("error", "Tạo tài khoản thất bại", message);
      return;
    }

    // Step 7: Clear password immediately on successful createAccount BEFORE waiting for Start
    setPassword("");

    if (mode === "create") {
      setLabel("");
      setUsername("");
      setServerIndex(0);
      setCharacterSlot(1);
      setSubmitMode(null);
      onSubmittingChange?.(false);
      push(
        "success",
        "Đã tạo tài khoản",
        `Tài khoản ${createdAccount.label} đã được tạo ở trạng thái đã dừng.`,
      );
      onClose?.();
      return;
    }

    // mode === "create-start"
    try {
      const result = await runCommand({
        accountId: createdAccount.id,
        type: "start",
      });

      setLabel("");
      setUsername("");
      setServerIndex(0);
      setCharacterSlot(1);
      setSubmitMode(null);
      onSubmittingChange?.(false);
      const statusLabel = ACCOUNT_STATUS_LABELS[result.account.status] ?? result.account.status;
      push(
        "success",
        "Đã tạo và khởi động tài khoản",
        `${result.account.label} hiện đang ${statusLabel}`,
      );
      onClose?.();
    } catch (error) {
      // Partial failure: Account ALREADY EXISTS!
      // Do NOT retry createAccount.
      // Reset form and close.
      setLabel("");
      setUsername("");
      setServerIndex(0);
      setCharacterSlot(1);
      setSubmitMode(null);
      onSubmittingChange?.(false);
      onClose?.();

      const isTimeout = isApiError(error) && error.code === "COMMAND_TIMEOUT";
      const title = isTimeout
        ? "Đã tạo tài khoản, lệnh Khởi động đang chờ xử lý"
        : "Đã tạo tài khoản, lệnh Khởi động thất bại";
      push("error", title, describeError(error));
    }
  };

  return (
    <Card className="p-4 sm:p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold tracking-tight">Thêm tài khoản</h2>
      </div>

      {ctlWarning ? (
        <div
          role="alert"
          className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning"
        >
          {ctlWarning}
        </div>
      ) : null}

      <form onSubmit={(e) => e.preventDefault()} noValidate className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField
            id="create-account-label"
            label="Tên hiển thị tài khoản"
            placeholder="ví dụ: Xa Thu 01"
            value={label}
            onChange={(e) => {
              setLabel(e.target.value);
              if (errors.label) setErrors((prev) => ({ ...prev, label: undefined }));
            }}
            disabled={isSubmitting}
            error={errors.label}
          />

          <SelectField
            id="create-account-server"
            label="Máy chủ game"
            options={[...SERVER_OPTIONS]}
            value={serverIndex}
            onChange={(e) => {
              setServerIndex(Number(e.target.value));
              if (errors.serverIndex) {
                setErrors((prev) => ({ ...prev, serverIndex: undefined }));
              }
            }}
            disabled={isSubmitting}
            error={errors.serverIndex}
          />

          <TextField
            id="create-account-username"
            label="Tên đăng nhập"
            placeholder="Tài khoản game"
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (errors.username) {
                setErrors((prev) => ({ ...prev, username: undefined }));
              }
            }}
            disabled={isSubmitting}
            autoComplete="off"
            error={errors.username}
          />

          <TextField
            id="create-account-password"
            label="Mật khẩu"
            type="password"
            placeholder="••••••••"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (errors.password) {
                setErrors((prev) => ({ ...prev, password: undefined }));
              }
            }}
            disabled={isSubmitting}
            autoComplete="new-password"
            error={errors.password}
          />

          <SelectField
            id="create-account-slot"
            label="Vị trí nhân vật"
            options={[
              { value: 1, label: "Slot 1 (Trái)" },
              {
                value: 2,
                label: isSlotCapable ? "Slot 2 (Giữa)" : "Slot 2 (Giữa) — Cần cập nhật runtime",
                disabled: !isSlotCapable,
              },
              {
                value: 3,
                label: isSlotCapable ? "Slot 3 (Phải)" : "Slot 3 (Phải) — Cần cập nhật runtime",
                disabled: !isSlotCapable,
              },
            ]}
            help={
              isSlotCapable
                ? "Vị trí nhân vật từ trái sang phải trong danh sách chọn nhân vật game."
                : "Slot 2 và 3 yêu cầu phiên bản runtime mới trên máy chủ VPS này. Vị trí từ trái sang phải."
            }
            value={characterSlot}
            onChange={(e) => {
              const val = Number(e.target.value);
              if (isValidCharacterSlot(val)) {
                setCharacterSlot(val);
                if (errors.characterSlot) {
                  setErrors((prev) => ({ ...prev, characterSlot: undefined }));
                }
              }
            }}
            disabled={isSubmitting}
            error={errors.characterSlot}
          />
        </div>

        {!isOnline && isCtlSupported ? (
          <p className="text-xs text-muted">
            Tài khoản có thể được tạo ngay bây giờ và khởi động khi máy chủ kết nối lại.
          </p>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={isSubmitting}
            onClick={onClose}
          >
            Hủy
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            busy={submitMode === "create"}
            disabled={!canCreateOnly}
            onClick={() => handleSubmit("create")}
          >
            Tạo tài khoản
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            busy={submitMode === "create-start"}
            disabled={!canCreateAndStart}
            onClick={() => handleSubmit("create-start")}
          >
            Tạo & Khởi động
          </Button>
        </div>
      </form>
    </Card>
  );
}
