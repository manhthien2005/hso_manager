> # ⚠️ BẢN NHÁP GỐC — ĐÃ ĐƯỢC THAY THẾ (2026-09-12)
>
> Đây là tài liệu kiến trúc ban đầu. Nó đã bị **đo và thay thế** bởi bộ specification ở
> **`../docs/full_spec/README.md`** (38 file / ~11 000 dòng, ba domain
> `build-docker` · `tool` · `web-manager`, dựa trên hai vòng verify chạy thật).
>
> Ba điểm trong bản này đã được chứng minh là **sai**, đọc tiếp sẽ dẫn tới code sai:
>
> | Mục | Bản này nói | Đã đo |
> |---|---|---|
> | §3, §14 | 2 JVM, mỗi JVM một MicroEmulator | argv dạng `-jar` **không start được MIDlet**; phải `-cp` + MIDlet class (`../docs/full_spec/build-docker/RUNTIME-SPEC.md` §3.2) |
> | §16 | `configs.json` — schema do web định nghĩa | jar đọc **35 khoá wire** fail-closed; lệch một khoá = auto tắt im lặng (`../docs/full_spec/tool/WIRE-CONTRACT.md` §2) |
> | §14 Phase 3 | 1 JVM chạy N MicroEmulator | **không khả thi** — `-Dzeus.player.out` / `-Dzeus.ctl.in` là property một giá trị mỗi JVM, hai MIDlet tranh cùng file |
>
> Bắt đầu từ **`../docs/full_spec/README.md`**.

# Zeus Knight Cloud Architecture

## 1. Mục tiêu

Xây dựng hệ thống quản lý nhiều VPS Railway chạy Knight Online theo mô hình:

- Mỗi người dùng có VPS Railway riêng.
- VPS chỉ tập trung chạy game và Zeus Agent.
- Người dùng quản lý VPS/account từ web dashboard.
- Config/account được đồng bộ và backup trên cloud.
- Chỉ mở viewer/noVNC khi thực sự cần xem màn hình game.
- Ưu tiên: **0 phí**, VPS nhẹ, setup nhanh, ít thành phần, không cần server trung tâm riêng.

---

## 2. Kiến trúc tổng thể

```text
                         ┌──────────────────────────┐
                         │         VERCEL           │
                         │      Zeus Web UI         │
                         │                          │
                         │ Login / Dashboard        │
                         │ VPS & Account Status     │
                         │ Config / Commands        │
                         │ Open Viewer              │
                         └────────────┬─────────────┘
                                      │
                                      │ HTTPS / Supabase SDK
                                      ▼
                         ┌──────────────────────────┐
                         │        SUPABASE          │
                         │                          │
                         │ Auth                     │
                         │ PostgreSQL Database      │
                         │ Realtime                 │
                         │ Config Backup            │
                         │ Device Mapping           │
                         │ Commands / Status        │
                         └────────────┬─────────────┘
                                      │
                              Realtime / HTTPS
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
             ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
             │ Railway VPS A│  │ Railway VPS B│  │ Railway VPS C│
             │ Zeus Agent   │  │ Zeus Agent   │  │ Zeus Agent   │
             │ Xvnc         │  │ Xvnc         │  │ Xvnc         │
             │ Knight x2    │  │ Knight x2    │  │ Knight x2    │
             └──────────────┘  └──────────────┘  └──────────────┘
```

Không cần Zeus Control Server riêng.

- **Vercel**: host frontend.
- **Supabase**: Auth + Database + Realtime + config backup.
- **Railway VPS**: chạy Zeus Agent + Knight runtime.

---

## 3. Knight Node trên Railway

Mỗi VPS là một **Knight Node** tối giản.

```text
Knight Node
│
├── Zeus Agent
├── Minimal Java Runtime
├── MicroEmulator
├── KnightOnline.jar
├── Xvnc
├── Tiny Window Manager
└── Runtime Config
```

Không cần:

```text
Ubuntu Desktop
XFCE / LXDE / GNOME / KDE
Chromium / Firefox
Electron
PulseAudio
SSH server
systemd
DBus nếu không cần
các daemon không liên quan
```

Mục tiêu:

> VPS chỉ chạy game, nhận lệnh/config từ cloud và mở màn hình khi người dùng yêu cầu.

---

## 4. Zeus Agent

Zeus Agent là service nhẹ chạy trong VPS.

Nhiệm vụ:

```text
Zeus Agent
│
├── map VPS với user
├── quản lý account
├── start / stop / restart game
├── monitor process
├── auto restart
├── đọc CPU / RAM
├── sync config
├── nhận command realtime
├── report status
└── quản lý remote viewer
```

Ưu tiên viết bằng **Rust** để giữ RAM thấp và không cần runtime riêng.

---

## 5. Mapping User ↔ VPS

Lần đầu deploy:

```text
Railway deploy
     │
     ▼
Zeus Agent start
     │
     ▼
Login / Pair Device
     │
     ▼
Supabase
     │
     ├── xác định user
     ├── tạo device_id
     └── map VPS với user
```

Một user có thể có nhiều VPS:

```text
User A
│
├── VPS SG-01
│   ├── Account 01
│   └── Account 02
│
└── VPS SG-02
    ├── Account 03
    └── Account 04
```

Không hard-code `1 user = 1 VPS`.

---

## 6. Zeus Web trên Vercel

Web dashboard chỉ cần giao diện nhẹ:

```text
ZEUS

SG-KNIGHT-01        ● Online
CPU                 12%
RAM                 248 MB
Uptime              18h

Account 01          ● Running
Account 02          ● Running

[Manage] [View]
```

Trang account:

```text
Account 01

Status              Running
Auto Restart        ON
Server              3
Character           KnightABC

[Start] [Stop] [Restart]

Configuration
────────────────────
...
```

Frontend không kết nối trực tiếp từng VPS để lấy trạng thái thông thường.  
Frontend đọc trạng thái từ Supabase.

---

## 7. Supabase

Supabase là trung tâm dữ liệu:

```text
Supabase
│
├── Auth
├── Devices
├── Accounts
├── Config
├── Commands
├── Runtime Status
├── Realtime
└── Backup
```

Supabase là **source of truth cho config**.

VPS chỉ giữ bản local để chạy runtime.

---

## 8. Config Sync

Khi user sửa config trên web:

```text
Web
 │
 │ Update Config
 ▼
Supabase
 │
 │ Realtime Event
 ▼
Zeus Agent
 │
 │ Apply Config
 ▼
Knight Runtime
```

Agent báo lại:

```text
config_version = 42
config_status  = applied
```

Nếu VPS offline:

```text
Cloud version = 42
Local version = 39
```

Khi VPS online lại:

```text
Zeus Agent
   │
   ▼
read cloud config
   │
   ▼
download version 42
   │
   ▼
apply
```

Nhờ vậy Railway restart/redeploy không làm mất config.

---

## 9. Command Flow

Các command cần realtime:

```text
Start
Stop
Restart
Apply Config
Game Crashed
Game Started
Game Stopped
```

Ví dụ:

```text
Browser
   │
   │ Restart Account 02
   ▼
Supabase
   │
   │ Realtime
   ▼
Zeus Agent
   │
   ▼
Restart JVM
   │
   ▼
Update status
   │
   ▼
Supabase
   │
   ▼
Browser
```

Không cần polling command mỗi 5–10 giây.

---

## 10. Metrics và Heartbeat

Không cần gửi CPU/RAM liên tục.

Đề xuất:

```text
Command             realtime
Config change       realtime
Crash event         realtime
Account state       realtime

CPU / RAM           30–60 giây
Heartbeat           ~60 giây
Full config sync    khi thay đổi
```

Mục tiêu là giảm:

- Realtime message count.
- Network traffic.
- CPU wakeups.
- Supabase free-tier usage.

---

## 11. Remote Viewer / noVNC

Viewer **không stream qua Supabase hoặc Vercel**.

```text
                CONTROL

Browser ─────── Supabase ─────── Zeus Agent


                 VIEW

Browser ════════════════════════ Railway VPS
                                  │
                                  ▼
                                 Xvnc
```

Khi user bấm `View`, browser kết nối trực tiếp tới viewer endpoint của VPS:

```text
Browser
   │
   │ WSS / noVNC
   ▼
Railway VPS
   │
   ▼
Xvnc
```

Lợi ích:

- giảm bandwidth cloud.
- giảm latency.
- tránh tốn free quota.
- giữ hệ thống đơn giản.

---

## 12. Viewer On-Demand

Khi không ai xem:

```text
Knight
  │
  ▼
Xvnc

No viewer connected
```

Không có VNC traffic ra Internet.

Khi user mở viewer:

```text
Browser
   │
   ▼
VNC / noVNC session
   │
   ▼
Xvnc
```

Khi đóng viewer, remote session kết thúc.

> Không mở viewer giúp giảm VNC encoding/network overhead, nhưng game vẫn render vào X server nếu MicroEmulator/AWT cần display.

---

## 13. Runtime VPS tối giản

Kiến trúc runtime:

```text
Railway VPS
│
├── Zeus Agent
├── Xvnc
├── Tiny WM
├── JVM #1
│   └── MicroEmulator
│       └── Knight Account #1
│
└── JVM #2
    └── MicroEmulator
        └── Knight Account #2
```

Không browser trong VPS.  
Không dashboard GUI trong VPS.

Dashboard được render trên thiết bị của user.

---

## 14. Hướng tối ưu Runtime

### Phase 1

```text
2 JVM
Xvnc
Tiny WM
Zeus Agent
```

Ưu tiên ổn định và dễ debug.

### Phase 2

Benchmark:

```text
HotSpot
vs
OpenJ9
```

Đo bằng:

- cgroup memory.
- PSS.
- CPU usage.
- startup time.
- runtime stability.

### Phase 3

Nghiên cứu:

```text
1 JVM
│
├── MicroEmulator Instance #1
│   └── Knight #1
│
└── MicroEmulator Instance #2
    └── Knight #2
```

Mục tiêu là chia sẻ JVM runtime và giảm memory footprint sâu hơn.

Có thể cần fork MicroEmulator để tách:

- RMS.
- profile path.
- `user.home`.
- per-account state.

---

## 15. Repo Knight Node

Repo có thể tổ chức:

```text
knight-node/
│
├── Dockerfile
├── zeus-agent/
├── runtime/
│   ├── java/
│   ├── microemulator/
│   └── KnightOnline.jar
│
├── display/
│   ├── Xvnc
│   └── tiny-wm
│
├── scripts/
│   ├── boot
│   └── healthcheck
│
└── config/
```

Dùng multi-stage build:

```text
Builder
   │
   ├── compile Zeus Agent
   ├── create minimal Java runtime
   └── prepare runtime files
            │
            ▼
Minimal Final Image
```

Final image chỉ chứa thứ cần để chạy production.

---

## 16. Database Model sơ bộ

```text
users
│
└── Supabase Auth


devices
├── id
├── user_id
├── name
├── status
├── cpu
├── ram
├── viewer_url
└── last_seen


accounts
├── id
├── device_id
├── name
├── status
└── runtime_state


configs
├── account_id
├── version
└── json


commands
├── id
├── device_id
├── account_id
├── command
├── status
└── created_at
```

Schema chi tiết sẽ được quyết định trong implementation plan.

---

## 17. Luồng hoạt động đầy đủ

### Deploy

```text
User
 │
 ▼
Deploy Knight Node lên Railway
 │
 ▼
Zeus Agent start
 │
 ▼
Login / Pair VPS
 │
 ▼
Supabase map VPS ↔ User
 │
 ▼
Download config
 │
 ▼
Start Knight
```

### Quản lý

```text
User
 │
 ▼
Zeus Web trên Vercel
 │
 ▼
Supabase
 │
 ├── status
 ├── accounts
 ├── config
 └── commands
      │
      ▼
 Zeus Agent
      │
      ▼
 Knight
```

### Xem màn hình

```text
User bấm View
      │
      ▼
Web lấy viewer endpoint
      │
      ▼
Browser kết nối trực tiếp VPS
      │
      ▼
noVNC / VNC
      │
      ▼
Xvnc
```

---

## 18. Chi phí mục tiêu

```text
Vercel Hobby        $0
Supabase Free       $0
Central VPS         không có
Redis               không có
Control Server      không có
Domain riêng        không bắt buộc
```

Railway VPS là tài nguyên riêng của từng user.

Có thể dùng domain mặc định của:

```text
Vercel
Supabase
Railway
```

để không phát sinh thêm chi phí.

---

## 19. Nguyên tắc kiến trúc

1. VPS chỉ chạy những gì Knight cần.
2. Web UI render trên thiết bị người dùng.
3. Supabase giữ config và state chính.
4. Zeus Agent chủ động kết nối outbound.
5. Command/config dùng realtime.
6. Metrics gửi chậm hơn.
7. noVNC chỉ mở khi cần.
8. VNC stream trực tiếp Browser ↔ VPS.
9. Không có central server riêng.
10. Không thêm service nếu chưa thực sự cần.

---

# Kiến trúc cuối cùng

```text
┌─────────────────────────────────────────────────────────────┐
│                         USER                                │
│                    Browser / Mobile                         │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────┐
                    │      Vercel      │
                    │   Zeus Web UI    │
                    └────────┬─────────┘
                             │
                             ▼
                    ┌──────────────────┐
                    │     Supabase     │
                    │ Auth / DB        │
                    │ Realtime         │
                    │ Config Backup    │
                    └────────┬─────────┘
                             │
                        WSS / HTTPS
                             │
            ┌────────────────┼─────────────────┐
            │                │                 │
            ▼                ▼                 ▼
       Railway VPS      Railway VPS       Railway VPS
       User A           User B            User C
            │                │                 │
       Zeus Agent       Zeus Agent        Zeus Agent
            │                │                 │
       Knight x2        Knight x2         Knight x2
            │                │                 │
          Xvnc             Xvnc              Xvnc

Viewer:

Browser ═══════════ Direct WSS / noVNC ═══════════> Railway VPS
```

---

## 20. Kết luận

Zeus gồm ba phần:

```text
1. Knight Node
   Docker image tối giản chạy Knight trên Railway.

2. Zeus Agent
   Service nhẹ quản lý runtime và đồng bộ với Supabase.

3. Zeus Web
   Dashboard trên Vercel để quản lý VPS/account.
```

Supabase đóng vai trò:

```text
Auth + Database + Realtime + Config Backup
```

Không cần backend server trung tâm chạy 24/7.

Tài liệu này là nền tảng để viết implementation plan chi tiết cho:

- Docker runtime.
- Zeus Agent.
- Supabase schema.
- Realtime protocol.
- Config synchronization.
- Web dashboard.
- noVNC viewer.
- Deployment workflow.
