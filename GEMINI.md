# Frontend Design & Coordination Rules

## Quy tắc phối hợp các Skill Thiết kế trong HSO Manager

### 1. Phân định vai trò
- **Impeccable (Quy trình & Kiểm duyệt)**:
  - Nếu chưa có `PRODUCT.md` / `DESIGN.md`, chạy `init` trước.
  - Trước khi viết code UI: chạy `shape` hoặc `craft`.
  - Sau khi viết code UI: thực hiện chu trình `critique` → `audit` → `polish`.
  - Sau **mỗi** lần chỉnh sửa UI: bắt buộc chạy `npx impeccable detect <file/thư mục vừa sửa>` và sửa triệt để tất cả lỗi được báo ra.
- **Taste Skill (Định hình Gu thẩm mỹ)**:
  - Tạo mới giao diện hoặc component: áp dụng `design-taste-frontend`.
  - Cải tạo, nâng cấp giao diện hiện có: áp dụng `redesign-existing-projects` (luôn `audit` trước, sửa sau).

### 2. Thứ tự ưu tiên khi có xung đột
`PRODUCT.md` / `DESIGN.md` của project (nội dung và thương hiệu website)
> Quy tắc chống AI slop của Impeccable
> Các tuỳ chọn / núm chỉnh của Taste Skill.

### 3. Nguyên tắc thẩm mỹ & Chống rập khuôn (Anti-AI Slop)
- Không dùng thiết kế mặc định chung chung: tránh font Inter/Arial/system mặc định, tránh gradient tím-xanh phổ thông, không dùng card lồng card, không dùng emoji làm icon, tránh layout 3 cột icon-tiêu đề-mô tả lặp lại.
- Mọi quyết định thiết kế (màu sắc, typography, spacing, layout hierarchy) đều phải có lý do gắn liền với ngữ cảnh thực tế của website.
