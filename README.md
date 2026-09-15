# Zeus Knight Cloud — Web UI

Control panel for managing Knight Online VPS fleets on Railway. Phase 1:
complete UI/UX running on **mock data** — no Supabase, no Zeus Agent, no noVNC.

Every screen is clickable and behaves like the real product: buttons show
loading states, commands resolve after a fake latency, state updates live, and
success/error toasts fire.

```
Stack   Next.js 16 (App Router) · TypeScript strict · Tailwind CSS 4
Deps    next, react, react-dom  — no UI kit, no chart lib, no animation lib
```

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
```

Sign in with the demo credentials shown on the login screen:

```
zeus / zeus1234
```

Any other combination is rejected with a real error toast, so the failure path
is testable too.

Other commands:

```bash
npm run build        # production build
npm start            # serve the production build
npm run lint         # eslint, warnings are failures (--max-warnings=0)
npx tsc --noEmit     # type check
```

The session lives in `sessionStorage`, so a reload keeps you signed in and a new
tab does not.

## What to look at

| Route | Shows |
| --- | --- |
| `/login` | Mock auth, inline + toast errors |
| `/` | Fleet summary, one card per VPS, live metrics |
| `/device/[deviceId]` | VPS detail: CPU/RAM bars, uptime, agent versions, accounts |
| `/device/[deviceId]/accounts` | Account list with status filter chips |
| `/device/[deviceId]/viewer` | noVNC placeholder frame, connect/disconnect |
| `/account/[accountId]/config` | Schema-driven config form, validation, save |
| `/settings` | Device registry: IDs, regions, versions, viewer tunnels |

Mock fleet: 2 VPS (one online, one offline) and 6 accounts spread across
`running`, `starting`, `stopped`, `error` and `offline`, so every visual state is
reachable from the sidebar.

Things worth clicking:

- **Stop / Start / Restart** on any account — spinner, latency, status change, toast.
- **Restart on Account 04** (already `error`) — the mock fails it, showing the error
  path and leaving the account in `error`.
- **Commands on SG-KNIGHT-02** — disabled with an explanation, because the device is offline.
- **Memory Limit 4096 → Save** — rejected by the over-commit rule, which computes
  real free RAM instead of a hardcoded threshold.
- **Clear the Character field → Save** — schema validation, per-field messages,
  save blocked.
- **Mobile (≤1024px)** — sidebar collapses into a drawer; cards stack; the config
  action bar stays pinned.

CPU and RAM drift every 4s from the mock's metrics simulation, driven through the
same `onUpdate` subscription that Supabase Realtime will use later.

## Layout

```
src/
├── app/
│   ├── (app)/          authenticated routes (route group; no URL segment)
│   │   ├── layout.tsx          AuthGate + sidebar/drawer shell
│   │   ├── page.tsx            dashboard
│   │   ├── device/[deviceId]/  page · accounts/ · viewer/
│   │   ├── account/[accountId]/config/
│   │   └── settings/
│   ├── login/
│   ├── layout.tsx      root layout (Server Component) + theme
│   └── globals.css     design tokens
├── components/
│   ├── ui/             button · card · field · status (the whole kit)
│   ├── accounts/       account-card · config-field
│   ├── devices/        device-card
│   ├── app-shell.tsx   AuthGate, sidebar, drawer, topbar
│   ├── page-header.tsx
│   ├── not-found-panel.tsx
│   └── providers.tsx   client provider boundary
├── hooks/              use-account-command
├── lib/
│   ├── types.ts        every shared domain type
│   ├── config-schema.ts  form sections, validation, draft mapping
│   └── format.ts       bytes/uptime/relative-time helpers
├── services/
│   ├── api.ts          ZeusApi contract + the single implementation choice
│   ├── mock-api.ts     in-memory implementation
│   └── seed-data.ts    the mock fleet
└── store/              zeus-store (data + pending flags) · toast-store
```

Data flows one way: `services` → `store` → `components`. Components never import
`services/mock-api.ts` and never read seed data directly — only `services/api.ts`.

See [`docs/UI_IMPLEMENTATION.md`](docs/UI_IMPLEMENTATION.md) for routes, the data
model, the mock API contract, and exactly where Supabase plugs in.
`ZEUS_ARCHITECTURE.md` covers the wider system (agents, Docker node, Supabase schema).

## Design tokens

Dark-only, semantic tokens in `src/app/globals.css` — `--surface`, `--border`,
`--accent`, `--online`, `--danger`, … Components never hardcode hex values.

`--accent-fill` is a deliberately darker companion to `--accent`: `#4c8dff` reads
well as text (6.1:1) but only reaches 3.2:1 under a white label, so filled
buttons use the darker shade. All text pairings meet WCAG AA (≥4.5:1) and
non-text components meet ≥3:1.

## Scope

Out of scope for this phase, by design: Zeus Agent, Docker Knight node,
Java/MicroEmulator, a separate backend, real noVNC, real VPS connections,
polling, WebSockets.
