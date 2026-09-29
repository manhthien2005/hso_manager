/**
 * Centralized Enhancement Status, Pipeline Stages & Error Translations
 * Task: ENHANCE-06C-COMPACT-QUEUE-UX-REDESIGN
 *
 * Implements:
 * 1. User-readable Vietnamese pipeline stages.
 * 2. Mapping of technical states to pipeline stages.
 * 3. Specific Vietnamese error translations for safe pre-fence vs true post-fence failures.
 * 4. Specific charm missing identification.
 */

import type {
  EnhancementAttemptPhase,
  EnhancementCharmMode,
  EnhancementQueueJob,
  EnhancementQueueItem,
  PlayerSnapshot,
} from "./types";

export type PipelineStageKey =
  | "validating_item"
  | "refreshing_inventory"
  | "traveling_to_forge"
  | "locating_npc"
  | "opening_forge"
  | "preparing_charm"
  | "loading_recipe"
  | "sending_request"
  | "waiting_result"
  | "reconciling_result"
  | "completed"
  | "failed"
  | "manual_review";

export interface PipelineStageInfo {
  key: PipelineStageKey;
  label: string;
  description: string;
  isSensitive: boolean; // Only true when in post-send waiting phase
  isError?: boolean;
  isSuccess?: boolean;
}

export const PIPELINE_STAGES: Record<PipelineStageKey, PipelineStageInfo> = {
  validating_item: {
    key: "validating_item",
    label: "Xác thực trang bị",
    description: "Kiểm tra tính hợp lệ và vị trí của trang bị trong túi đồ.",
    isSensitive: false,
  },
  refreshing_inventory: {
    key: "refreshing_inventory",
    label: "Kiểm tra túi đồ",
    description: "Cập nhật dữ liệu túi đồ mới nhất từ máy chủ.",
    isSensitive: false,
  },
  traveling_to_forge: {
    key: "traveling_to_forge",
    label: "Di chuyển tới lò rèn",
    description: "Nhân vật đang tự động di chuyển đến khu vực lò rèn.",
    isSensitive: false,
  },
  locating_npc: {
    key: "locating_npc",
    label: "Tìm thợ rèn",
    description: "Xác định vị trí và tương tác với NPC thợ rèn.",
    isSensitive: false,
  },
  opening_forge: {
    key: "opening_forge",
    label: "Mở lò rèn",
    description: "Mở giao diện cường hóa của thợ rèn.",
    isSensitive: false,
  },
  preparing_charm: {
    key: "preparing_charm",
    label: "Chuẩn bị bùa",
    description: "Kiểm tra và chuẩn bị bùa theo chính sách đã chọn.",
    isSensitive: false,
  },
  loading_recipe: {
    key: "loading_recipe",
    label: "Nạp công thức & tài nguyên",
    description: "Chuẩn bị nguyên liệu, vàng và công thức cường hóa.",
    isSensitive: false,
  },
  sending_request: {
    key: "sending_request",
    label: "Gửi yêu cầu cường hóa",
    description: "Đang phát lệnh cường hóa tới máy chủ game.",
    isSensitive: true,
  },
  waiting_result: {
    key: "waiting_result",
    label: "Chờ kết quả từ máy chủ",
    description: "Đang chờ kết quả phản hồi từ máy chủ game.",
    isSensitive: true,
  },
  reconciling_result: {
    key: "reconciling_result",
    label: "Đối soát kết quả",
    description: "Đối soát thay đổi trang bị và hạch toán tài nguyên.",
    isSensitive: false,
  },
  completed: {
    key: "completed",
    label: "Hoàn thành",
    description: "Đã hoàn thành toàn bộ mục trong hàng đợi.",
    isSensitive: false,
    isSuccess: true,
  },
  failed: {
    key: "failed",
    label: "Thất bại",
    description: "Hàng đợi dừng do gặp lỗi hoặc điều kiện không thỏa mãn.",
    isSensitive: false,
    isError: true,
  },
  manual_review: {
    key: "manual_review",
    label: "Cần kiểm tra thủ công",
    description: "Tạm dừng an toàn để tránh rủi ro khi trạng thái chưa rõ ràng.",
    isSensitive: true,
    isError: true,
  },
};

/**
 * Returns human-readable charm display name from charm mode key.
 */
export function getCharmDisplayName(charmMode?: EnhancementCharmMode | string | null): string {
  switch (charmMode) {
    case "CO_3_LA":
    case "THREE_LEAF":
      return "Bùa Cỏ 3 lá";
    case "CO_4_LA":
    case "FOUR_LEAF":
      return "Bùa Cỏ 4 lá";
    case "AUTO_POLICY":
      return "Bùa Cỏ 3 lá hoặc 4 lá";
    default:
      return "Bùa cường hóa";
  }
}

export interface TranslatedError {
  title: string;
  detail: string;
  isPreFenceMismatch: boolean;
  isPostFenceAmbiguity: boolean;
  recommendedAction: string;
}

/**
 * Translates technical error code and message into clear Vietnamese.
 * Distinguishes safe pre-fence mismatches from dangerous post-fence ambiguities.
 */
export function translateEnhancementError(
  errorCode: string | null | undefined,
  errorMessage: string | null | undefined,
  charmMode?: EnhancementCharmMode | string | null,
): TranslatedError {
  const code = (errorCode ?? "").toUpperCase();

  if (code === "CHARM_MISSING") {
    const charmName = getCharmDisplayName(charmMode);
    return {
      title: `Thiếu ${charmName}`,
      detail: `Không tìm thấy ${charmName} trong túi đồ nhân vật.`,
      isPreFenceMismatch: true,
      isPostFenceAmbiguity: false,
      recommendedAction: "Vui lòng chuẩn bị bùa trong túi đồ, nhấn 'Làm mới túi đồ' và thử lại.",
    };
  }

  if (code === "ITEM_MISSING_OR_CHANGED") {
    return {
      title: "Trang bị đã di chuyển hoặc thay đổi",
      detail: "Vật phẩm tại ô đã chọn đã thay đổi hoặc di chuyển trước khi gửi lệnh.",
      isPreFenceMismatch: true,
      isPostFenceAmbiguity: false,
      recommendedAction: "Nhấn 'Làm mới túi đồ' để cập nhật vị trí mới nhất rồi chọn lại trang bị.",
    };
  }

  if (code === "AMBIGUOUS_WIRE_TARGET") {
    return {
      title: "Phát hiện nhiều trang bị tương đồng",
      detail: "Có nhiều trang bị giống nhau trong túi đồ khiến hệ thống không thể định danh duy nhất.",
      isPreFenceMismatch: true,
      isPostFenceAmbiguity: false,
      recommendedAction: "Vui lòng tách hoặc sắp xếp lại trang bị trong túi đồ và thử lại.",
    };
  }

  if (code === "INSUFFICIENT_GOLD") {
    return {
      title: "Không đủ Vàng",
      detail: "Nhân vật không có đủ số Vàng cần thiết để thực hiện lượt cường hóa này.",
      isPreFenceMismatch: true,
      isPostFenceAmbiguity: false,
      recommendedAction: "Vui lòng nạp thêm Vàng cho nhân vật và làm mới túi đồ.",
    };
  }

  if (code === "INSUFFICIENT_GEMS") {
    return {
      title: "Không đủ Ngọc (Gems)",
      detail: "Tài khoản không có đủ số Ngọc cần thiết để trả phí cường hóa.",
      isPreFenceMismatch: true,
      isPostFenceAmbiguity: false,
      recommendedAction: "Vui lòng nạp thêm Ngọc hoặc chuyển sang phương thức thanh toán bằng Vàng.",
    };
  }

  if (code === "INSUFFICIENT_MATERIALS") {
    return {
      title: "Không đủ vật liệu",
      detail: "Thiếu đá hoặc nguyên liệu cường hóa trong túi đồ nhân vật.",
      isPreFenceMismatch: true,
      isPostFenceAmbiguity: false,
      recommendedAction: "Vui lòng chuẩn bị đủ vật liệu trong túi đồ rồi làm mới.",
    };
  }

  if (code === "BLACKSMITH_NOT_FOUND") {
    return {
      title: "Không tìm thấy thợ rèn",
      detail: "Không thể định vị NPC thợ rèn tại bản đồ hiện tại.",
      isPreFenceMismatch: false,
      isPostFenceAmbiguity: false,
      recommendedAction: "Vui lòng di chuyển nhân vật về thành phố hoặc khu vực có thợ rèn.",
    };
  }

  if (code === "FORGE_OPEN_FAILED") {
    return {
      title: "Không thể mở giao diện thợ rèn",
      detail: "Tương tác với NPC thất bại hoặc không thể mở giao diện đập đồ.",
      isPreFenceMismatch: false,
      isPostFenceAmbiguity: false,
      recommendedAction: "Kiểm tra lại trạng thái nhân vật trong game và thử lại.",
    };
  }

  if (code === "BLACKSMITH_ROUTE_UNAVAILABLE") {
    return {
      title: "Không có đường tới thợ rèn",
      detail: "Không thể tìm đường di chuyển tự động tới khu vực thợ rèn.",
      isPreFenceMismatch: false,
      isPostFenceAmbiguity: false,
      recommendedAction: "Di chuyển nhân vật tới gần NPC thợ rèn trước khi bắt đầu.",
    };
  }

  if (code === "ENHANCEMENT_TRAVEL_CONFLICT") {
    return {
      title: "Xung đột di chuyển",
      detail: "Quá trình di chuyển tới lò rèn bị gián đoạn hoặc bị cản trở bởi trạng thái khác.",
      isPreFenceMismatch: false,
      isPostFenceAmbiguity: false,
      recommendedAction: "Dừng các hoạt động tự động khác và thử lại.",
    };
  }

  if (code === "SERVER_REJECTED") {
    return {
      title: "Máy chủ từ chối yêu cầu",
      detail: "Máy chủ game từ chối yêu cầu cường hóa.",
      isPreFenceMismatch: false,
      isPostFenceAmbiguity: false,
      recommendedAction: "Vui lòng đợi vài giây và thử lại.",
    };
  }

  if (code === "FAILURE_PROTECTED") {
    return {
      title: "Cường hóa thất bại (Được bảo vệ)",
      detail: "Lượt cường hóa không thành công, bùa bảo vệ đã giữ nguyên cấp độ trang bị.",
      isPreFenceMismatch: false,
      isPostFenceAmbiguity: false,
      recommendedAction: "Trang bị được bảo toàn an toàn. Bạn có thể tiếp tục cường hóa.",
    };
  }

  if (code === "FAILURE_DEGRADED") {
    return {
      title: "Cường hóa thất bại (Hạ cấp)",
      detail: "Lượt cường hóa không thành công và trang bị đã bị giảm 1 cấp độ.",
      isPreFenceMismatch: false,
      isPostFenceAmbiguity: false,
      recommendedAction: "Bạn có thể thiết lập lại mục tiêu và thử lại.",
    };
  }

  if (code === "ITEM_DESTROYED") {
    return {
      title: "Trang bị bị phá hủy",
      detail: "Lượt cường hóa thất bại khiến trang bị bị phá hủy vĩnh viễn.",
      isPreFenceMismatch: false,
      isPostFenceAmbiguity: false,
      recommendedAction: "Hàng đợi đã dừng an toàn để bảo vệ các trang bị còn lại.",
    };
  }

  if (code === "QUEUE_RUNTIME_STALE") {
    return {
      title: "Máy chủ runtime phản hồi chậm",
      detail: "Máy chủ runtime mất kết nối hoặc phản hồi chậm hơn ngưỡng an toàn.",
      isPreFenceMismatch: false,
      isPostFenceAmbiguity: false,
      recommendedAction: "Kiểm tra trạng thái thiết bị VPS/Runtime và kết nối mạng.",
    };
  }

  if (code === "QUEUE_RUNTIME_UNSUPPORTED") {
    return {
      title: "Runtime chưa hỗ trợ hàng đợi",
      detail: "Máy chủ runtime chưa hỗ trợ token capability enhancement-queue-v1.",
      isPreFenceMismatch: false,
      isPostFenceAmbiguity: false,
      recommendedAction: "Vui lòng cập nhật phiên bản runtime tương thích.",
    };
  }

  if (code === "MANUAL_REVIEW_REQUIRED" || code === "OUTCOME_UNRESOLVED") {
    return {
      title: "Cần kiểm tra thủ công",
      detail:
        "Lệnh cường hóa đã được phát đi nhưng chưa thể chốt kết quả từ máy chủ game. Hệ thống TẮT tính năng tự động thử lại (Không retry) để bảo vệ tài khoản và ngăn ngừa cường hóa lặp lại.",
      isPreFenceMismatch: false,
      isPostFenceAmbiguity: true,
      recommendedAction: "Vui lòng kiểm tra nhân vật trong game và bấm 'Xử lý / Đóng hàng đợi'.",
    };
  }

  // Fallback generic error
  return {
    title: errorCode ? `Lỗi: ${errorCode}` : "Thao tác không thành công",
    detail: errorMessage || "Tiến trình cường hóa đã dừng do gặp lỗi hoặc điều kiện không thỏa mãn.",
    isPreFenceMismatch: false,
    isPostFenceAmbiguity: false,
    recommendedAction: "Kiểm tra lại trang bị và trạng thái nhân vật trước khi thử lại.",
  };
}

/**
 * Maps technical job/item/snapshot states to a precise user-readable pipeline stage.
 * Never reports post-send ambiguity during travel, NPC location or forge opening.
 */
export function determineCurrentPipelineStage(
  jobStatus: EnhancementQueueJob["status"],
  activeItem?: Pick<
    EnhancementQueueItem,
    "attemptPhase" | "charmMode" | "settlementSource" | "status"
  > | null,
  snapshot?: Pick<
    PlayerSnapshot,
    "enhancephase" | "travelstate" | "travel"
  > | null,
): PipelineStageKey {
  if (jobStatus === "COMPLETED") return "completed";
  if (jobStatus === "FAILED") return "failed";
  if (jobStatus === "MANUAL_REVIEW_REQUIRED" || activeItem?.status === "MANUAL_REVIEW_REQUIRED") {
    return "manual_review";
  }

  if (jobStatus === "RUNNING" || jobStatus === "PAUSING") {
    const phase: EnhancementAttemptPhase = activeItem?.attemptPhase ?? "NONE";

    if (phase === "WAITING_RESULT") {
      return "waiting_result";
    }
    if (phase === "EXECUTE_MAY_HAVE_BEEN_SENT") {
      return "sending_request";
    }
    if (phase === "WAITING_SETTLEMENT" || activeItem?.settlementSource === "STATE_RECONCILED") {
      return "reconciling_result";
    }
    if (phase === "READY_TO_EXECUTE") {
      return "loading_recipe";
    }

    // Inspect runtime game client telemetry if present
    if (snapshot) {
      if (snapshot.enhancephase === 1 || snapshot.travelstate === 1 || snapshot.travel === 1) {
        return "traveling_to_forge";
      }
      if (snapshot.enhancephase === 2) {
        return "locating_npc";
      }
      if (snapshot.enhancephase === 3) {
        return "opening_forge";
      }
      if (snapshot.enhancephase === 4) {
        return "loading_recipe";
      }
      if (snapshot.enhancephase === 5) {
        return "preparing_charm";
      }
      if (snapshot.enhancephase === 6) {
        return "sending_request";
      }
      if (snapshot.enhancephase === 7) {
        return "waiting_result";
      }
    }

    if (phase === "PREPARING") {
      if (activeItem?.charmMode && activeItem.charmMode !== "NONE") {
        return "preparing_charm";
      }
      return "validating_item";
    }

    return "validating_item";
  }

  if (jobStatus === "QUEUED") {
    return "validating_item";
  }

  return "validating_item";
}
