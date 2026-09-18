# Zeus Knight Online — Web Control Plane (HSO Manager)

Giao diện quản trị tập trung (Control Plane Web UI) cho hệ thống tự động hóa Knight Online (Hiệp Sĩ Online - HSO) trên nền tảng VPS / Cloud.

![Next.js](https://img.shields.io/badge/Next.js-16.3.4-black?style=flat-square&logo=next.js)
![React](https://img.shields.io/badge/React-19.2.8-blue?style=flat-square&logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue?style=flat-square&logo=typescript)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?style=flat-square&logo=tailwindcss)
![Supabase](https://img.shields.io/badge/Supabase-Database%20%26%20Realtime-3ecf8e?style=flat-square&logo=supabase)

---

## 🌟 Tính năng chính

- **🖥️ Quản lý Đội ngũ VPS / Nodes (Fleet Management)**: Giám sát toàn bộ các thiết bị (devices) đang chạy bot, trạng thái kết nối (`online`, `offline`, `degraded`), phiên bản Agent, thông số CPU, RAM và Uptime.
- **🔗 Ghép nối Thiết bị Bảo mật (Secure Device Pairing)**: Ghép nối node mới vào tài khoản quản trị viên thông qua mã Pair Code (6 ký tự) và chữ ký khóa công khai Ed25519 với hàm RPC `claim_device`.
- **🕹️ noVNC Web Viewer Trực tiếp**: Xem màn hình máy chủ VPS / thiết bị trực tiếp trên trình duyệt qua kết nối iframe noVNC với cơ chế cấp phép tạm thời (timed lease) và tự động khử tham số nhạy cảm.
- **⚙️ Quản trị Cấu hình Tự động (Config Editor)**: Biểu mẫu tinh chỉnh 34 thông số bot/account thời gian thực, có xác thực schema chặt chẽ trước khi lưu vào Supabase JSONB.
- **📊 Giám sát & Telemetry Thời gian thực**: Theo dõi chỉ số trạng thái nhân vật (`ctl`, `atkstate`, `xp_permille`, vị trí, vật phẩm).
- **⚡ Dual-Mode API Architecture**: Tự động chuyển đổi giữa `supabaseApi` (chạy dữ liệu thực tế với Postgres Changes) và `mockApi` (chế độ demo độc lập không cần backend).

---

## 🏗️ Kiến trúc Hệ thống

```
┌─────────────────────────────────────────────────────────────┐
│                    Next.js 16 Web Manager                   │
│  (App Router, React 19, Tailwind CSS 4, Zeus Store Context) │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │
               ▼ (API Gateway / Switch)        ▼ (iframe)
     ┌──────────────────┐            ┌──────────────────┐
     │   Supabase API   │            │  noVNC HTML5     │
     │  (Real Database) │            │  Remote Viewer   │
     └─────────┬────────┘            └──────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│           Supabase Cloud Backend             │
│  - Auth (User email / session)               │
│  - Tables: devices, accounts, commands, ...  │
│  - RPC: claim_device, verify_device_token    │
│  - Realtime: postgres_changes broadcasts     │
└──────────────────────────────────────────────┘
```

---

## 📁 Cấu trúc Thư mục

```
web-manager/
├── docs/                           # Tài liệu thiết kế & UI spec
│   └── UI_IMPLEMENTATION.md
├── public/                         # Static assets (svg, favicon)
├── src/
│   ├── app/
│   │   ├── (app)/                  # Các route được bảo vệ bởi layout chính
│   │   │   ├── page.tsx            # Dashboard tổng quan
│   │   │   ├── pair/               # Màn hình ghép nối node
│   │   │   ├── device/[deviceId]/  # Chi tiết thiết bị & noVNC viewer
│   │   │   ├── account/[accountId]/# Cấu hình tài khoản & telemetry
│   │   │   └── settings/           # Cài đặt hệ thống
│   │   ├── login/                  # Trang đăng nhập Supabase Auth
│   │   ├── globals.css             # Tailwind CSS v4 design tokens
│   │   └── layout.tsx              # Root Layout
│   ├── components/                 # UI components tái sử dụng
│   │   ├── accounts/               # Account cards, config fields, telemetry
│   │   ├── devices/                # Device cards & metrics display
│   │   └── ui/                     # Base design components (Button, Card, Status)
│   ├── hooks/                      # Custom React hooks (useAccountCommand, ...)
│   ├── lib/                        # Type definitions, Supabase client, schema
│   │   ├── config-schema.ts        # 34 control keys schema
│   │   ├── database.types.ts       # Supabase Database TypeScript definitions
│   │   └── supabase.ts             # Supabase client initializer
│   ├── services/                   # Data Access Layer
│   │   ├── api.ts                  # ZeusApi interface & dynamic provider
│   │   ├── mock-api.ts             # Mock implementation for zero-config preview
│   │   └── supabase-api.ts         # Production Supabase implementation
│   └── store/                      # React context stores (ZeusStore, ToastStore)
├── supabase/
│   └── migrations/                 # Toàn bộ database schema & migrations (001 - 007)
├── .env.example                    # Biến môi trường mẫu
├── .gitignore                      # Git ignore chuẩn hóa
├── package.json
└── tsconfig.json
```

---

## 🚀 Hướng dẫn Cài đặt & Khởi chạy

### 1. Yêu cầu Hệ thống
- **Node.js**: Phiên bản 20.x trở lên.
- **npm** (hoặc `pnpm`, `yarn`).

### 2. Cài đặt Dependencies
```bash
npm install
```

### 3. Cấu hình Môi trường
Sao chép file `.env.example` thành `.env.local`:
```bash
cp .env.example .env.local
```
Điền các giá trị từ Supabase Project Dashboard của bạn:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

> **Lưu ý**: Nếu bạn không cung cấp biến môi trường Supabase, ứng dụng sẽ tự động chạy ở chế độ **Mock Data**, cho phép bạn trải nghiệm toàn bộ giao diện và luồng thao tác mà không cần kết nối cơ sở dữ liệu thật.

### 4. Khởi chạy Development Server
```bash
npm run dev
```
Mở trình duyệt tại [http://localhost:3000](http://localhost:3000).

---

## 🗄️ Thiết lập Cơ sở dữ liệu (Supabase Migrations)

Toàn bộ các tệp di chuyển dữ liệu nằm trong thư mục `supabase/migrations/`:
1. `001_zeus_schema.sql`: Khởi tạo các bảng `devices`, `accounts`, `account_runtime`, `commands`, RLS và index.
2. `002_grants.sql`: Phân quyền cho `anon`, `authenticated`, `service_role`.
3. `003_device_auth.sql`: Hàm RPC xác thực thiết bị và hàm `claim_device`.
4. `004_pubkey_bytea_fix.sql`: Chuẩn hóa kiểu lưu trữ khóa công khai Ed25519.
5. `005_fix_claim_device_pgcrypto.sql`: Cấu hình hỗ trợ extension pgcrypto.
6. `006_fix_claim_device_on_conflict.sql`: Xử lý xung đột khi tái liên kết thiết bị.
7. `007_fix_device_persistence_and_pubkey_unique.sql`: Đảm bảo tính duy nhất của pubkey và lưu trữ bền vững.

Bạn có thể áp dụng các migration này thông qua **Supabase CLI** hoặc chạy trực tiếp trong **Supabase SQL Editor**:
```bash
# Áp dụng qua Supabase CLI (nếu dùng local development)
supabase db reset
# Hoặc đẩy lên remote project
supabase db push
```

---

## 🛠️ Các Lệnh Thường dùng

| Lệnh | Mục đích |
|---|---|
| `npm run dev` | Khởi chạy dev server trên `http://localhost:3000` |
| `npm run build` | Build production bundle tối ưu |
| `npm start` | Chạy production server sau khi build |
| `npm run lint` | Kiểm tra quy chuẩn mã nguồn với ESLint |
| `npx tsc --noEmit` | Kiểm tra tĩnh kiểu dữ liệu TypeScript |

---

## 🛡️ Bản quyền & Bảo mật
Dự án được thiết kế tuân thủ tiêu chuẩn an ninh nghiêm ngặt:
- Khóa bí mật và token không bao giờ được commit lên repository.
- Toàn bộ giao tiếp giữa Web và Thiết bị được thông qua hàng đợi lệnh có chữ ký số hoặc mã hóa RLS của Supabase.
