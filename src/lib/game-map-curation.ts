/**
 * Curated Game Map Product Metadata
 *
 * Contains product-level display name overrides and contextual notes
 * that intentionally augment or clarify raw authoritative facts from client resources.
 *
 * DO NOT put raw engine facts here.
 * DO NOT manually duplicate generated catalog data.
 */

export interface GameMapDisplayOverride {
  readonly expectedRawNameVi: string | null;
  readonly displayName: string;
}

/**
 * Explicit display overrides for maps where the raw Vietnamese client name
 * is ambiguous, empty, or absent.
 *
 * Approved override set:
 * - 53, 55, 57, 59: Faction battle preparation rooms (all named "Chuẩn bị" in raw client)
 * - 81: Unnamed map (empty string "" in df.gE[81])
 * - 127: Unnamed dead-end destination (null in client data)
 */
export const GAME_MAP_DISPLAY_OVERRIDES: Readonly<Record<number, GameMapDisplayOverride>> = {
  53: {
    expectedRawNameVi: "Chuẩn bị",
    displayName: "Chuẩn bị (Ánh sáng)",
  },
  55: {
    expectedRawNameVi: "Chuẩn bị",
    displayName: "Chuẩn bị (Gió)",
  },
  57: {
    expectedRawNameVi: "Chuẩn bị",
    displayName: "Chuẩn bị (Sét)",
  },
  59: {
    expectedRawNameVi: "Chuẩn bị",
    displayName: "Chuẩn bị (Lửa)",
  },
  81: {
    expectedRawNameVi: "",
    displayName: "Bản đồ 81 (Chưa đặt tên)",
  },
  127: {
    expectedRawNameVi: null,
    displayName: "UNKNOWN (Bản đồ 127)",
  },
} as const;

/**
 * Curated contextual notes displayed in the Web UI (e.g. config help text).
 */
export const GAME_MAP_NOTES: Readonly<Record<number, string>> = {
  0: "Khu tân thủ xuất phát",
  1: "Thị trấn trung tâm, hồi sinh, đá dịch chuyển",
  4: "Có đá dịch chuyển",
  5: "Có đá dịch chuyển",
  7: "Ngã rẽ lớn Region 1",
  8: "Có đá dịch chuyển",
  9: "Có đá dịch chuyển",
  11: "Có đá dịch chuyển",
  12: "Có đá dịch chuyển",
  13: "Có đá dịch chuyển",
  15: "Có đá dịch chuyển",
  16: "Có đá dịch chuyển",
  17: "Có đá dịch chuyển",
  18: "Cửa hang nối Region 1 và 2",
  19: "Bến phà Haku nối sang map 67",
  20: "Có đá dịch chuyển",
  21: "Đường mê cung mazeChain",
  22: "Có đá dịch chuyển",
  24: "Trung tâm sa mạc, có đá dịch chuyển",
  26: "Có đá dịch chuyển",
  28: "Vùng Boss ngoài trời",
  29: "Có đá dịch chuyển",
  31: "Có đá dịch chuyển",
  32: "Phòng boss Mummy",
  33: "Thị trấn trung tâm Region 2, có đá dịch chuyển",
  36: "Đấu trường phụ nối từ map 33",
  37: "Có đá dịch chuyển",
  38: "Đường mê cung mazeChain",
  39: "Có đá dịch chuyển",
  41: "Đường mê cung mazeChain, có đá dịch chuyển",
  43: "Có đá dịch chuyển",
  45: "Có đá dịch chuyển",
  46: "Đấu trường phụ nối từ map 33",
  48: "Phó bản chính (vào qua NPC Phó chỉ huy Map 1)",
  49: "Phó bản sự kiện",
  50: "Vườn nối từ Map 1, có đá dịch chuyển",
  51: "Đích nối từ map 41",
  52: "Nối 45 và 62",
  53: "Phòng chờ chiến trường",
  54: "Làng phe phái ánh sáng",
  55: "Phòng chờ chiến trường",
  56: "Làng phe phái gió",
  57: "Phòng chờ chiến trường",
  58: "Làng phe phái sét",
  59: "Phòng chờ chiến trường",
  60: "Làng phe phái lửa",
  61: "Chiến trường phe phái tổng",
  62: "Nối từ Cổng địa ngục 52",
  67: "Thị trấn Region 3, bến phà Haku, có đá dịch chuyển",
  74: "Cửa vào Mê cung, có đá dịch chuyển",
  77: "Có đá dịch chuyển",
  79: "Tầng cuối nối sang Cổng trắng 92",
  80: "Đấu trường giải đấu",
  81: "Chuỗi rỗng trong df.gE[81]",
  82: "Khu chợ phi chiến đấu",
  83: "Cổng phụ thị trấn",
  84: "Cổng phụ thị trấn",
  85: "Cổng phụ thị trấn",
  86: "Cổng phụ thị trấn",
  87: "Đấu trường tự do",
  88: "Slot dự phòng client",
  89: "Slot dự phòng client",
  90: "Slot dự phòng client",
  91: "Slot dự phòng client",
  92: "Cửa ngõ vùng Núi Tuyết nối từ 79",
  93: "Thị trấn Núi Tuyết, có đá dịch chuyển",
  94: "Có đá dịch chuyển",
  95: "Có đá dịch chuyển",
  96: "Đường mê cung mazeChain, có đá dịch chuyển",
  97: "Có đá dịch chuyển",
  98: "Điểm cuối Núi Tuyết, có đá dịch chuyển",
  127: "Đích cụt một chiều từ 135, không có tên trong client",
  135: "Map xuất phát một chiều (ra map 1 và 127), không thể route tới",
} as const;
