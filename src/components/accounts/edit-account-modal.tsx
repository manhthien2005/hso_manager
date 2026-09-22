"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { SelectField, TextField } from "@/components/ui/field";
import {
  isCharacterSlotAvailableOnDevice,
  isValidCharacterSlot,
  validateCharacterSlotSelection,
} from "@/lib/capabilities";
import { SERVER_OPTIONS } from "@/lib/game-servers";
import type { Account, CharacterSlot, UpdateAccountInput } from "@/lib/types";
import { describeError } from "@/services/api";
import { pendingKey, useZeusStore } from "@/store/zeus-store";
import { useToast } from "@/store/toast-store";

interface EditAccountModalProps {
  account: Account;
  isOpen: boolean;
  onClose: () => void;
}

export function EditAccountModal({
  account,
  isOpen,
  onClose,
}: EditAccountModalProps) {
  if (!isOpen) return null;

  return (
    <EditAccountModalContent
      key={account.id}
      account={account}
      onClose={onClose}
    />
  );
}

function EditAccountModalContent({
  account,
  onClose,
}: {
  account: Account;
  onClose: () => void;
}) {
  const { updateAccount, isPending, getDevice, devices } = useZeusStore();
  const { push } = useToast();

  const device = getDevice(account.deviceId) ?? devices.find((d) => d.deviceId === account.deviceId);
  const isSlotCapable = isCharacterSlotAvailableOnDevice(device);

  const initialServer = account.serverId ?? account.config?.serverId ?? 0;
  const currentUsername = account.config.accountName;
  const initialSlot = (account.character_slot ?? 1) as CharacterSlot;

  const [label, setLabel] = useState(account.label);
  const [username, setUsername] = useState(currentUsername);
  const [password, setPassword] = useState("");
  const [serverIndex, setServerIndex] = useState(initialServer);
  const [characterSlot, setCharacterSlot] = useState<CharacterSlot>(initialSlot);

  const [errors, setErrors] = useState<{
    label?: string;
    username?: string;
    password?: string;
    serverIndex?: string;
    characterSlot?: string;
  }>({});

  const isSubmitting = isPending(pendingKey.accountUpdate(account.id));
  const usernameChanged = username !== currentUsername;
  const isRunning = ["running", "starting", "restarting"].includes(account.status);
  const isStoredSlotUnsupported = initialSlot > 1 && !isSlotCapable;

  // Close on Escape if not submitting
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

    const newErrors: {
      label?: string;
      username?: string;
      password?: string;
      serverIndex?: string;
      characterSlot?: string;
    } = {};

    const trimmedLabel = label.trim();

    if (trimmedLabel.length === 0) {
      newErrors.label = "Tên hiển thị tài khoản không được để trống";
    }

    if (username.trim().length === 0) {
      newErrors.username = "Tên đăng nhập không được để trống";
    }

    if (usernameChanged && password.length === 0) {
      newErrors.password = "Bắt buộc nhập mật khẩu khi thay đổi tên đăng nhập.";
    }

    if (
      typeof serverIndex !== "number" ||
      !Number.isInteger(serverIndex) ||
      !SERVER_OPTIONS.some((server) => server.value === serverIndex)
    ) {
      newErrors.serverIndex = "Vui lòng chọn một máy chủ game hợp lệ";
    }

    const currentDevice = getDevice(account.deviceId) ?? devices.find((d) => d.deviceId === account.deviceId);
    const currentCapable = isCharacterSlotAvailableOnDevice(currentDevice);
    const slotError = validateCharacterSlotSelection(characterSlot, currentCapable, initialSlot);
    if (slotError) {
      newErrors.characterSlot = slotError;
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    const serverChanged = serverIndex !== (account.serverId ?? account.config?.serverId);
    const credentialsChanged = usernameChanged || password.length > 0;
    const slotChanged = characterSlot !== initialSlot;

    let credentials: UpdateAccountInput["credentials"] = undefined;
    if (!usernameChanged && password.length > 0) {
      // Case B: Password change only - preserve exact current username
      credentials = {
        username: currentUsername,
        password,
      };
    } else if (usernameChanged && password.length > 0) {
      // Case D: Username change + password supplied
      credentials = {
        username,
        password,
      };
    }

    try {
      const updated = await updateAccount({
        accountId: account.id,
        label: trimmedLabel,
        serverIndex,
        credentials,
        character_slot: characterSlot,
      });

      // Clear password state immediately after Save to minimize sensitive lifetime
      setPassword("");
      onClose();

      if (isRunning && (serverChanged || credentialsChanged || slotChanged)) {
        push(
          "info",
          "Đã cập nhật tài khoản",
          "Đã lưu. Khởi động lại tài khoản để áp dụng thay đổi máy chủ, thông tin đăng nhập hoặc vị trí nhân vật.",
        );
      } else {
        push(
          "success",
          "Đã cập nhật tài khoản",
          `Tài khoản ${updated.label} đã được cập nhật thành công.`,
        );
      }
    } catch (error) {
      // Clear password on error to protect credentials in memory, keep modal open
      setPassword("");
      push("error", "Cập nhật tài khoản thất bại", describeError(error));
    }
  };

  const slotOptions = [
    { value: 1, label: "Slot 1 (Trái)" },
    {
      value: 2,
      label:
        isSlotCapable || initialSlot === 2
          ? "Slot 2 (Giữa)" + (initialSlot === 2 && !isSlotCapable ? " (Hiện tại — Chưa hỗ trợ)" : "")
          : "Slot 2 (Giữa) — Cần cập nhật runtime",
      disabled: !isSlotCapable && initialSlot !== 2,
    },
    {
      value: 3,
      label:
        isSlotCapable || initialSlot === 3
          ? "Slot 3 (Phải)" + (initialSlot === 3 && !isSlotCapable ? " (Hiện tại — Chưa hỗ trợ)" : "")
          : "Slot 3 (Phải) — Cần cập nhật runtime",
      disabled: !isSlotCapable && initialSlot !== 3,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-account-title"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) {
          onClose();
        }
      }}
    >
      <Card className="w-full max-w-lg p-4 sm:p-5 shadow-xl border-border bg-elevated">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 id="edit-account-title" className="text-sm font-semibold tracking-tight">
              Chỉnh sửa tài khoản
            </h2>
            <p className="mt-0.5 font-mono text-[11px] text-muted">{account.id}</p>
          </div>
        </div>

        {isStoredSlotUnsupported ? (
          <div
            role="alert"
            className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-xs text-warning"
          >
            Tài khoản đang cấu hình Slot {initialSlot}, nhưng máy chủ hiện tại chưa thể xác minh hỗ trợ tính năng chọn vị trí nhân vật. Giá trị đã lưu được giữ nguyên trừ khi bạn chuyển về Slot 1.
          </div>
        ) : null}

        {isRunning ? (
          <div
            role="alert"
            className="mb-4 rounded-md border border-accent/30 bg-accent/10 p-3 text-xs text-foreground/90"
          >
            Tài khoản này hiện đang hoạt động. Thay đổi máy chủ, thông tin đăng nhập hoặc vị trí nhân vật sẽ có hiệu lực sau khi khởi động lại tài khoản.
          </div>
        ) : null}

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <TextField
              id="edit-account-label"
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
              id="edit-account-server"
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
              id="edit-account-username"
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
              id="edit-account-password"
              label="Mật khẩu"
              type="password"
              placeholder="Để trống nếu giữ nguyên mật khẩu"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (errors.password) {
                  setErrors((prev) => ({ ...prev, password: undefined }));
                }
              }}
              disabled={isSubmitting}
              autoComplete="new-password"
              help={
                usernameChanged
                  ? "Bắt buộc nhập mật khẩu khi thay đổi tên đăng nhập."
                  : "Để trống nếu muốn giữ nguyên mật khẩu hiện tại"
              }
              error={errors.password}
            />

            <SelectField
              id="edit-account-slot"
              label="Vị trí nhân vật"
              options={slotOptions}
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
              help={
                isStoredSlotUnsupported
                  ? "Máy chủ chưa hỗ trợ chọn vị trí mới. Bạn có thể giữ nguyên giá trị đã lưu hoặc chuyển về Slot 1."
                  : isSlotCapable
                    ? "Vị trí nhân vật từ trái sang phải trong danh sách chọn nhân vật game."
                    : "Slot 2 và 3 yêu cầu phiên bản runtime mới trên máy chủ VPS này. Vị trí từ trái sang phải."
              }
              error={errors.characterSlot}
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
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
              disabled={isSubmitting}
            >
              Lưu thay đổi
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
