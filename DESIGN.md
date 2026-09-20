# Design System Specification — Storm Steel

<!-- impeccable:design-schema 1 -->

## 1. Design Principles

- **Product / Operations-First**: Xây dựng bảng điều khiển vận hành công nghiệp (industrial control plane) cho người quản lý VPS Knight Online. 85–90% tập trung vào sự rõ ràng, mật độ thông tin và độ tin cậy; 10–15% nhận diện "Storm Steel" (thép lạnh, điểm xuyết xanh sét điện). Tuyệt đối không biến thành game fantasy cosplay, không viền vàng, không chữ gothic, không gradient tím-xanh.
- **2-Second Fleet Scan**: Người vận hành nhìn trong 2 giây là biết ngay toàn bộ hệ thống có ổn định không, node nào offline/error, account nào đang kẹt cần xử lý.
- **Three-Layer Information Architecture**:
  1. *Attention Layer*: Nổi bật các vấn đề cấp bách (offline, error, degraded health, failed commands, version mismatch, stuck warning).
  2. *Operational Layer*: Các nút hành động và thông tin thao tác thường xuyên (start/stop/restart, switch view, config save, pair node).
  3. *Diagnostic Layer*: Thông số kỹ thuật chuyên sâu (CPU/RAM metrics, PID, versions, snapshot telemetries 48 keys); đặt ở tầng thứ cấp, chỉ mở rộng khi cần (disclosure/drawer/tabs) để không gây nhiễu tầng vận hành.
- **Domain Contract Honesty**: Giao diện phản ánh trung thực trạng thái dữ liệu (DeviceStatus 3 trạng thái; AccountStatus 6 trạng thái; HealthStatus 3 trạng thái; không phát minh trạng thái giả lập).

---

## 2. Taste Parameters

- `DESIGN_VARIANCE = 3` (Bố cục có trật tự cao, cân đối công nghiệp, tránh phá cách tùy tiện)
- `MOTION_INTENSITY = 2` (Chuyển động tối giản 120–180ms ease-out, chỉ áp dụng cho transition trạng thái thực tế; không bounce, không lặp vô tận)
- `VISUAL_DENSITY = 7` (Mật độ thông tin cao phục vụ quan sát chuyên sâu, tận dụng không gian hàng/bảng, không lãng phí khoảng trắng)

---

## 3. Semantic Tokens (Tailwind CSS v4 `@theme inline` / OKLCH Starting Point)

Tất cả màu sắc được cấu hình thông qua biến CSS ngữ nghĩa trong `src/app/globals.css`, đảm bảo độ tương phản text >= 4.5:1 và non-text boundaries >= 3:1.

### 3.1. Surface & Neutral Hierarchy
- `--background`: `oklch(0.16 0.012 255)` (Thép tối thẫm sâu, không dùng `#000000` thuần)
- `--surface`: `oklch(0.20 0.012 255)` (Bề mặt panel, card, thanh công cụ chính)
- `--elevated`: `oklch(0.25 0.014 255)` (Bề mặt nâng nhẹ: table header, hover state, modal dialog)
- `--border`: `oklch(0.30 0.012 255)` (Đường kẻ phân tách hairline tinh tế, 1px)
- `--border-interactive`: `oklch(0.48 0.015 255)` (Viền input, nút bấm, đạt chuẩn tương phản non-text >= 3:1)

### 3.2. Text & Content
- `--foreground`: `oklch(0.94 0.008 255)` (Văn bản chính, sắc nét trên nền tối, tương phản ~12:1)
- `--muted`: `oklch(0.72 0.012 255)` (Nhãn phụ, metadata, caption, tương phản ~5.5:1)
- `--subtle`: `oklch(0.55 0.012 255)` (Icon phụ, placeholder)

### 3.3. Storm Accent (Tiết chế & Chủ đích)
- `--accent`: `oklch(0.82 0.11 230)` (Lightning Blue — dùng cho focus ring, tab đang chọn, icon nổi bật)
- `--accent-fill`: `oklch(0.46 0.14 250)` (Màu nền nút bấm hành động chính, đảm bảo chữ trắng đạt >= 4.5:1)
- `--accent-subtle`: `oklch(0.25 0.05 240)` (Nền chip hoặc highlight nhẹ)

### 3.4. Semantic Status Colors (Tách biệt hoàn toàn khỏi Accent)
- **Healthy / Running**:
  - `--status-healthy`: `oklch(0.76 0.16 145)` (Xanh lục công nghiệp)
  - `--status-healthy-bg`: `oklch(0.24 0.06 145 / 0.25)`
- **Warning / Degraded / Starting**:
  - `--status-warning`: `oklch(0.78 0.15 75)` (Hổ phách cảnh báo)
  - `--status-warning-bg`: `oklch(0.25 0.06 75 / 0.25)`
- **Danger / Error / Failed**:
  - `--status-danger`: `oklch(0.70 0.20 25)` (Đỏ cảnh báo sự cố)
  - `--status-danger-bg`: `oklch(0.25 0.08 25 / 0.25)`
- **Offline / Stopped / Idle**:
  - `--status-offline`: `oklch(0.65 0.015 255)` (Xám thép nguội)
  - `--status-offline-bg`: `oklch(0.22 0.015 255 / 0.4)`

---

## 4. Typography & Numbers

- **Font Sans**: Kế thừa `Geist` hiện hữu (hoặc font sans kỹ thuật), clean, hỗ trợ dấu tiếng Việt chuẩn xác (`Ứng dụng ẵm ặc ề ữ`).
- **Font Mono**: `Geist Mono` dùng cho Device ID, Account ID, Hexadecimal pair code, số phiên bản, tọa độ game (`px`, `py`), cổng mạng.
- **Tabular Numerics**: Áp dụng `.tabular` (`font-variant-numeric: tabular-nums`) cho toàn bộ bảng số liệu: CPU %, RAM MB, Uptime, Level, HP/MP.
- **Line-height**: Tối thiểu 1.35 cho body text. Tránh uppercase kéo dài, chỉ dùng uppercase tracking-wider cho micro-labels (11px).

---

## 5. Component Direction

### 5.1. Status Badges & Primitives
- Hiển thị theo nguyên tắc tam hợp: **[Glyph] + [Text Label] + [Màu ngữ nghĩa]**.
  - Healthy/Online: `● Online` hoặc `● Running` (chấm tĩnh, KHÔNG nhấp nháy liên tục).
  - Transition: `◌ Starting` / `◌ Restarting` (chuyển động pulse/spin tinh tế).
  - Degraded: `◐ Degraded` (cảnh báo chưa có snapshot hoặc ctl!=1).
  - Offline/Stopped: `○ Offline` / `○ Stopped`.
  - Error/Failed: `▲ Error`.

### 5.2. Buttons & Actions
- Kích thước: `sm` (32px), `md` (40px) trên desktop, đảm bảo vùng chạm touch target >= 44px trên mobile (`min-h-[44px]` hoặc padding tương ứng).
- Nút bấm có trạng thái `busy` tích hợp Spinner, tự động khóa thao tác khi gửi lệnh.
- Thao tác phá hủy/rủi ro cao (Stop / Restart account): Nút viền đỏ, yêu cầu xác nhận rõ ràng với danh tính account.

### 5.3. Cards & Panels
- Giảm thiểu việc đóng khung "card trong card trong card".
- Sử dụng đường kẻ phân tách 1px (`border-border`) hoặc subtle background strip thay vì lồng nhiều lớp hộp viền nổi.
- Padding chuẩn: `p-3` hoặc `p-4` để giữ mật độ thông tin cao.

### 5.4. List Rows & Hybrid Panels
- Dashboard chuyển từ lưới card 3 cột cồng kềnh sang dạng bảng/hàng lai (Compact Status Strip & Node Rail).
- Hiển thị tổng quan node, số account đang chạy, và các cảnh báo nổi bật mà không bắt buộc render toàn bộ progress bar CPU/RAM cho từng node khỏe mạnh.

---

## 6. Information Architecture & Responsive Layout

### 6.1. Desktop (>= 1024px)
- Fixed Navigation Sidebar (240px) bên trái, tích hợp chỉ báo trạng thái trực tiếp trên từng device node (`online`/`offline`/`error`) để tiện điều hướng.
- Sửa lỗi tràn/cắt xén container ở footer sidebar (phần email & Sign out).
- Nội dung chính:
  1. *Attention Rail*: Xuất hiện đầu trang nếu có node/account lỗi hoặc offline.
  2. *Fleet Summary Strip*: Dòng tóm tắt gọn gàng (ví dụ: `8 VPS online · 1 offline · 14 running · 2 need attention`).
  3. *Nodes List*: Bố cục hàng compact ưu tiên quét ngang, nhấn mạnh trạng thái vận hành.

### 6.2. Mobile (< 768px, tối ưu 375px)
- Topbar thu gọn với logo và nút hamburger menu mở Navigation Drawer.
- Tóm tắt Fleet dạng 1 dòng badge/chip gọn, không để 5 khối KPI card đẩy danh sách node xuống dưới nếp gấp màn hình (fold).
- Từng node hiển thị theo chiều dọc, nút thao tác Start/Stop được bố trí dễ ngón tay cái chạm tới (>=44px target).
- Tầng chẩn đoán (CPU, RAM chi tiết, 48 telemetry keys) đưa vào dạng accordions/disclosure, mặc định thu gọn.

---

## 7. Motion & Interaction Standards

- Thời lượng: `120ms – 180ms` với `ease-out`.
- Không sử dụng hiệu ứng nảy (bounce), không dùng animation chạy vòng lặp vô tận trên các thành phần tĩnh.
- Tuân thủ nghiêm ngặt `prefers-reduced-motion: reduce`: vô hiệu hóa toàn bộ transition và transform khi hệ điều hành yêu cầu.

---

## 8. Hard Anti-Patterns (Bị cấm hoàn toàn)

- KHÔNG dùng gradient tím-xanh AI bão hòa (`purple-to-blue gradient`).
- KHÔNG dùng hiệu ứng phát sáng ngoài neon (`neon outer glow`).
- KHÔNG dùng hiệu ứng kính mờ giả tạo (`glassmorphism` / giant blurred blobs).
- KHÔNG dùng bố cục 4 thẻ KPI lớn giống hệt nhau kiểu SaaS chung chung.
- KHÔNG dùng card lồng card lồng card.
- KHÔNG dùng emoji làm icon đại diện cho tính năng.
- KHÔNG dùng theme fantasy hiệp sĩ thời trung cổ (khung viền vàng, giấy da parchment, font gothic).
- KHÔNG dùng style hacker terminal màu xanh lá matrix.
- KHÔNG tạo animation nhấp nháy liên tục cho node/account đang ở trạng thái khỏe mạnh (`online`).

---

## 9. Domain UX Rules & Guardrails

1. **Device Status**: Chỉ dùng `"online" | "offline" | "error"`. Không hiển thị nhãn `"degraded"` ở cấp Device (Supabase adapter map degraded thành error).
2. **Account Status vs Health Status**:
   - Status (Process): `running | starting | stopped | restarting | error | offline`.
   - Health: `running | degraded | stopped`. Phản ánh tính hợp lệ của process + telemetry snapshot + ctl==1.
   - `atkstate` và `stuck` là telemetry hành vi trong game, KHÔNG được gộp vào trạng thái sống chết của bot process.
3. **Command Feedback**:
   - Hiển thị theo chu kỳ thực: `Queued (đã gửi) → Running (agent đang xử lý) → Success / Failed (kết thúc)`.
   - Không đánh dấu "Completed" khi lệnh mới chỉ ở trạng thái `queued`.
4. **Config Editor & Attack Spot (Map 0)**:
   - Map 0 là bản đồ hợp lệ: *"Khu tân thủ xuất phát"*.
   - Sentinel cho "No attack spot" là chuỗi UI `__none__`.
   - Giá trị lưu wire tuple cho "No spot" là: `atk.map = 0`, `zone = -1`, `x = -1`, `y = -1`.
   - Giữ nguyên cơ chế `attackMapIntent` trong form config để bảo toàn lựa chọn người dùng trước khi nhập tọa độ.
5. **Pairing Code**:
   - Mã gồm đúng 8 ký tự Hexadecimal (`[0-9A-F]{8}`).
   - Form hỗ trợ 8 ô nhập đơn, auto-advance, backspace, paste chuỗi 8 ký tự, validation tức thời.
6. **Remote Viewer**:
   - Trọng tâm của màn hình `/device/[deviceId]/viewer` là khung hiển thị noVNC, không để các thông tin phụ lấn át khung hình máy chủ.

---

## 10. Verification Contract (Áp dụng khi triển khai)

Mọi thay đổi trong các phase sau bắt buộc phải vượt qua các lệnh kiểm chứng:
- `npm run lint`
- `npx tsc --noEmit`
- `npm run verify:catalog` (khi đụng chạm catalog maps/servers)
- `npm run verify:attack-spot` (khi đụng chạm attack spot logic)
- `npx impeccable detect <target>`
- `npm run build`
