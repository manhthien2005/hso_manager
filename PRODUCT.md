# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primary user: Operator sở hữu một hoặc một cụm máy chủ ảo (VPS) chạy bot tự động hóa Knight Online (Hiệp Sĩ Online - HSO).
- Am hiểu sâu sắc thuật ngữ game Knight Online (server, map, zone, attack coordinates, inventory, buffs, travel, dungeon).
- Tần suất truy cập cao, thường xuyên kiểm tra nhanh trong ngày và giám sát trực ca đêm.
- Thao tác trên cả desktop (trạm làm việc) và thiết bị di động (mobile smartphone khi đang di chuyển).
- Ưu tiên tối thượng là nắm bắt trạng thái vận hành thực tế (operational state) và phát hiện sự cố tức thì, không cần đồ thị phân tích kiểu marketing hay SaaS hào nhoáng.

## Product Purpose

HSO Manager (Zeus Knight Online Web Control Plane) là trạm điều khiển web tập trung phục vụ việc giám sát, ra lệnh điều khiển (Start / Stop / Restart), cấu hình bot 34 tham số tự động và truy cập remote viewer (noVNC) cho đội ngũ VPS bot Knight Online.
- Mục tiêu thành công (North-star UX): Trong vòng 2 giây liếc nhìn giao diện, Operator phải nắm rõ toàn bộ fleet có khỏe mạnh hay không, node nào hoặc account nào đang gặp sự cố cần can thiệp xử lý ngay.

## Positioning

Trạm điều hành kỹ thuật chuyên sâu (Industrial Operations Control Plane) chuẩn xác, tin cậy và tức thời dành riêng cho bot Knight Online; tách biệt hoàn toàn với các bảng điều khiển game cosplay giả tưởng hoặc dashboard SaaS chung chung.

## Operating Context

- Môi trường sử dụng: Văn phòng, góc làm việc đa màn hình hoặc màn hình điện thoại di động trong điều kiện ánh sáng yếu (ban đêm).
- Thiết bị quản lý: Cụm VPS (thường chạy 1-2 accounts mỗi node, nhưng kiến trúc hỗ trợ số lượng động).
- Nhịp điệu dữ liệu (Data Cadence):
  - Commands, cấu hình, sự kiện: Realtime hoặc cận realtime (khoảng 1 giây khi polling lệnh).
  - Telemetry phần cứng VPS (CPU, RAM): Cập nhật mỗi 30–60 giây.
  - Heartbeat thiết bị: Cập nhật mỗi 60 giây.
  - Giao diện phản ánh trung thực nhịp cập nhật thực tế, không tạo cảm giác realtime giả tạo từng mili-giây.

## Capabilities and Constraints

- Capabilities:
  - Giám sát Fleet: Theo dõi trạng thái node (`online`, `offline`, `error`), phiên bản Agent/Jar, chỉ số CPU, RAM, Uptime.
  - Điều khiển tài khoản: Start, Stop, Restart với vòng đời lệnh tường minh (`queued` → `running` → `success` / `failed` / `expired`).
  - Quản trị cấu hình: Trình biên tập 34 tham số (Schema v13) với phân tầng điều khiển, xác thực tọa độ tấn công (Map 0 hợp lệ; No spot là `(0, -1, -1, -1)`).
  - Remote noVNC Viewer: Kết nối màn hình ảo trực tiếp qua tunnel có thời hạn (timed lease).
  - Ghép nối thiết bị (Device Pairing): Nhập mã ghép nối 8 ký tự Hexadecimal (`[0-9A-F]{8}`) xác thực qua Supabase RPC `claim_device`.
  - Hỗ trợ kiến trúc Dual-API: Hoạt động trơn tru trên cả `supabaseApi` và `mockApi`.
- Constraints & Known Tech Debt:
  - DeviceStatus hiển thị ở UI contract chỉ có: `"online" | "offline" | "error"`. Không tự ý thêm `"degraded"` vào DeviceStatus.
  - Account HealthStatus gồm 3 trạng thái: `"running"` (process sống + snapshot hợp lệ + ctl==1), `"degraded"` (process sống nhưng thiếu snapshot hoặc ctl!=1), `"stopped"` (process tắt). Không gộp `atkstate` hay `stuck` vào health.
  - `account_runtime.applied_version` tồn tại trong DB nhưng chưa được expose lên UI `Account` type; UI chỉ xác nhận trạng thái lưu DB (`DB saved`) và không được tạo trạng thái `Agent applied` giả khi chưa có contract.
  - Tuyệt đối không thay đổi schema database, file migration, hay interface `ZeusApi`.

## Brand Commitments

- Product Register: Industrial operations software. Chỉ màn hình Login được phép mang một lượng nhận diện thương hiệu nhẹ; các màn hình vận hành giữ vững tính công cụ kỹ thuật thuần túy.
- Tone of Voice: Điềm tĩnh (Calm), Chuẩn xác (Precise), Mang tính kỹ thuật (Technical), Đáng tin cậy (Reliable).
- Tinh thần "Storm Steel": Cứng cáp, sắc gọn, bề mặt kim loại nguội lạnh với điểm nhấn xanh tia sét (Lightning Blue) tiết chế tối đa; tuyệt đối KHÔNG cosplay fantasy, không viền vàng thời trung cổ, không chữ gothic.

## Evidence on Hand

- Mã nguồn thực tế: `src/` (Next.js 16.3.4, React 19, Tailwind CSS v4).
- Contract catalog: 101 game maps (`@/lib/game-maps`), 8 server options (`@/lib/game-servers`), và danh mục ghi chú override (`@/lib/game-map-curation`).
- Wire contract logic: `src/lib/attack-spot.ts` quản lý chuẩn mực Map 0 và canonical tuple cho No spot.
- Cấu hình 34 key: `src/lib/config-schema.ts`.
- Mẫu kiểm chứng scripts: `scripts/verify-catalog-drift.ts`, `scripts/verify-attack-spot.ts`.

## Product Principles

1. **2-Second Fleet Scan**: Thông tin ưu tiên hành động (Attention Layer) luôn hiển thị trước; người vận hành nhìn lướt là định vị được sự cố ngay lập tức.
2. **Three-Layer Information Architecture**: Phân tách rành mạch Attention Layer (sự cố/cảnh báo) → Operational Layer (thao tác thường xuyên) → Diagnostic Layer (thông số chuyên sâu); chẩn đoán không bao giờ được che khuất vận hành.
3. **Domain Contract Integrity**: Tuyệt đối trung thực với trạng thái backend; không phát minh trạng thái giả, không giả lập tiến trình chưa được xác nhận.
4. **Storm Steel Aesthetic Restraint**: 85-90% giao diện điều hành công nghiệp chuyên nghiệp, 10-15% bản sắc Storm Steel; cấm tiệt AI slop, gradient tím-xanh, thẻ lồng thẻ, icon emoji.
5. **Mobile & High-Density Usability**: Đảm bảo mật độ thông tin cao cho chuyên gia nhưng vẫn giữ target chạm >=44px và phân cấp trực quan tối ưu trên màn hình nhỏ.

## Accessibility & Inclusion

- Hỗ trợ Dark mode chuẩn hóa độ tương phản text >= 4.5:1, non-text controls >= 3:1.
- Hiển thị trạng thái đa kênh (Glyph icon + Text nhãn + Màu ngữ nghĩa), không chỉ phụ thuộc vào màu sắc.
- Hỗ trợ bàn phím đầy đủ với `:focus-visible` rõ ràng.
- Tôn trọng thuộc tính hệ thống `prefers-reduced-motion` (chuyển động 120-180ms ease-out, không bounce, không pulse liên tục với trạng thái ổn định).
