# UI Implementation — Zeus Knight Cloud

Phase 1 notes: what exists, how data flows, and where Supabase plugs in later.

Scope covered here is the web UI only. For agents, the Docker Knight node and the
database schema see `ZEUS_ARCHITECTURE.md`.

```
Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind CSS 4
Runtime deps: next, react, react-dom — nothing else
```

## Routes

All authenticated screens live in the `(app)` route group, which contributes no
URL segment but does contribute a layout. `/login` sits outside it.

| Route | File | Notes |
| --- | --- | --- |
| `/login` | `src/app/login/page.tsx` | Mock auth; redirects to `/` when a session exists |
| `/` | `src/app/(app)/page.tsx` | Dashboard: fleet summary + one card per VPS |
| `/device/[deviceId]` | `src/app/(app)/device/[deviceId]/page.tsx` | VPS detail |
| `/device/[deviceId]/accounts` | `.../accounts/page.tsx` | Account list + status filter |
| `/device/[deviceId]/viewer` | `.../viewer/page.tsx` | noVNC placeholder |
| `/account/[accountId]/config` | `src/app/(app)/account/[accountId]/config/page.tsx` | Config form |
| `/settings` | `src/app/(app)/settings/page.tsx` | Device registry |

`src/app/(app)/layout.tsx` wraps the group in `AuthGate`.

### Two IDs, deliberately

`Device.id` (`dev_01`) is the internal key; `Device.deviceId`
(`zk-sg-knight-01-a93f`) is the agent fingerprint and the only one that appears in
URLs. `mockApi` accepts either on lookup so a wrong guess fails loudly instead of
silently matching nothing. The sidebar, dashboard and every link agree on
`deviceId`.

### `params` is a Promise

Next 16 hands dynamic segments to client pages as `Promise<{...}>`, consumed with
`use(params)`. That is why every detail page starts with `use()` rather than
destructuring props directly.

## Component inventory

`src/components/ui/` is the entire kit — four files, no library:

| Component | File | Purpose |
| --- | --- | --- |
| `Button`, `ButtonLink`, `Spinner` | `ui/button.tsx` | `busy` shows a spinner and disables; `ButtonLink` renders the same visuals as a real `<a>` |
| `Card`, `CardHeader`, `FactRow`, `EmptyState` | `ui/card.tsx` | Panels and label/value rows |
| `DeviceStatusBadge`, `AccountStatusBadge`, `MetricBar`, `KeyValue` | `ui/status.tsx` | All status colours in one place |
| `TextField`, `SelectField`, `TextArea`, `ToggleField` | `ui/field.tsx` | Uniform label/help/error presentation |

Feature components: `app-shell.tsx` (`AuthGate`, sidebar, drawer, topbar),
`devices/device-card.tsx`, `accounts/account-card.tsx`,
`accounts/config-field.tsx`, `page-header.tsx`, `not-found-panel.tsx`,
`providers.tsx`. One hook: `hooks/use-account-command.ts`.

`ButtonLink` exists because `<Link><Button/></Link>` produces `<a><button>`,
which is invalid nesting and breaks keyboard activation. Navigation links that
look like buttons use it.

`ViewerSurface` (inside `viewer/page.tsx`) is the single mount point for noVNC —
a fixed `aspect-video` frame with `data-viewer-host="novnc"`. Nothing else in the
app references the transport.

## Data model

All types in `src/lib/types.ts`; nothing is redeclared anywhere else.

```ts
User { id, email, username, displayName }

Device { id, deviceId, userId, name, region, status: DeviceStatus,
         agentVersion, runtimeVersion, lastSeen, viewerAvailable, metrics }
DeviceStatus = "online" | "offline" | "error"
DeviceMetrics { cpu, ramUsedMb, ramTotalMb, uptimeSeconds }

Account { id, deviceId, label, status: AccountStatus, characterName,
          serverId, ramMb, pid, config }
AccountStatus = "running" | "starting" | "stopped" | "restarting"
              | "error" | "offline"

AccountConfig { accountName, characterName, serverId, autoStart, autoRestart,
                memoryLimitMb, restartDelaySeconds, additionalArgs, automation }
AutomationConfig { autoLogin, autoPickServer, startupDelaySeconds,
                   restartEveryMinutes, followSchedule, activeFrom, activeTo }

Command { id, accountId, deviceId, type, status, createdAt, finishedAt, message }
CommandType = "start" | "stop" | "restart" | "apply-config"
            | "open-viewer" | "close-viewer"

RuntimeStatus { deviceId, status, metrics, accounts[] }   // live, not persisted
ViewerSession { id, deviceId, url, transport, state, createdAt, reason }
ViewerTransport = "novnc" | "mock"
Toast { id, tone, title, description }
FleetSummary { devices, accounts, running, stopped, error, devicesOnline }
```

Timestamps are epoch-ms numbers, not `Date`, so they survive a JSON round-trip
through Supabase unchanged. `lastSeen: null` means "never reported".

`Account.characterName`, `serverId`, `ramMb` and `pid` are nullable: a stopped
account has no process, and the UI renders `—` rather than inventing values.

`RuntimeStatus` is declared but not yet consumed — it is the shape the agent's
heartbeat will arrive in. Keeping it here means the Supabase implementation can
be typed before it exists.

## Mock API

`src/services/api.ts` declares the `ZeusApi` interface; `src/services/mock-api.ts`
implements it in memory over `src/services/seed-data.ts`.

```
getSession, login, logout
getDevices, getDevice, refreshDevice
getAccounts(deviceId?), getAccount, updateAccountConfig
sendCommand
getViewerSession, connectViewer, disconnectViewer
onUpdate(listener) -> unsubscribe
```

Behaviour the UI depends on:

- **Latency** — 250–650ms per call, randomised, so loading states are real.
- **Command lifecycle** — `sendCommand` resolves twice: once to flip the account
  into a transient state (`starting`, `restarting`), again to settle it. The
  button spinner covers both beats.
- **Failure paths** — an account already in `error` fails its restart; commands
  against an offline device are rejected; saving a config that over-commits RAM
  is rejected. Each throws `ApiError` with a distinct `code`, and the message is
  what the toast shows.
- **Over-commit rule** — free RAM is `ramTotal - ramUsed + this account's own
  ram`, so re-saving an unchanged limit always passes while a genuine
  over-commit does not.
- **Metrics simulation** — a 4s interval jitters CPU and per-account RAM and
  pushes the results through `onUpdate`. It starts lazily, stops when the last
  listener unsubscribes, and never runs during SSR.

State lives behind a lazy getter rather than a module-level initializer, so
React StrictMode's double render cannot reset it.

## Store

`src/store/zeus-store.tsx` is the only place that calls `api`. Components read
`devices`, `accounts`, `viewerSessions` and invoke actions; they never import a
service.

- **`pending`** — a `Record<string, boolean>` keyed by `pendingKey.*`, so one
  account's Stop button can spin while its Restart stays enabled. Keys are built
  by exported helpers, never by string concatenation at the call site.
- **`onUpdate`** — registered once for the provider's lifetime; each event
  patches a single row by id and bails out when the value is identical, which is
  why the 4s metrics tick does not re-render the whole tree.
- **Bootstrap** — `getSession()` then, if signed in, one fleet load. `ready`
  flips only after that, so pages never render an empty fleet and mistake it for
  a missing device.
- **Viewer sessions** are fetched with the fleet rather than on viewer mount,
  which keeps that page free of data-fetching effects.

`src/store/toast-store.tsx` is an independent stack with per-toast timers.

### Config form

> ⚠️ **The 15 fields below are infrastructure parameters, and none of them is read by the game.**
> The jar reads a different, much stricter set: **35 wire keys** (`zeus-control.txt`, `CTL_VERSION 13`),
> and it fails *closed* — one unknown or missing key turns every module off while the JVM keeps
> running, so a dashboard watching "process alive" still reports green. Verified 2026-09-12.
>
> This form must be rewritten against that contract before any of it reaches a real node. The
> authoritative key table, value ranges and the version-gate rule live in
> `../../docs/full_spec/tool/WIRE-CONTRACT.md` §4; the web-side work is `../../docs/full_spec/web-manager/WEB-SPEC.md` §4.
> Three fields here should simply be dropped: `automation.autoPickServer` (the client picks the
> server itself via the `isIndexServer` record store), `automation.autoLogin` (AUTH is always on),
> and `additionalArgs` (the agent builds argv; free-form args are a way to break launch).
>
> The schema-driven *shape* described below is worth keeping — that is what makes the rewrite cheap.

`src/lib/config-schema.ts` describes the form as data: 3 sections, 15 fields,
each with a `ConfigPath`, control type, optional bounds and help text.
`ConfigForm` renders that array and owns draft state — it holds no per-field
knowledge.

Adding a field means adding one descriptor and one `AccountConfig` property; the
renderer, draft mapping and validation all follow. That is the point: the real
Knight runtime config will change.

Validation runs on submit, then live once a failed save has happened, so fields
do not light up while the user is still typing. Number values stay strings in
the draft so an empty field reads as invalid instead of becoming `0`.

`ConfigForm` is keyed by account id and seeds its draft with a lazy `useState`
initializer. Realtime metric ticks therefore never overwrite what is being typed.

## Supabase integration points

Four seams, in the order they should be tackled.

**1. Implementation swap** — write `src/services/supabase-api.ts` satisfying
`ZeusApi`, then change one line in `src/services/api.ts`:

```ts
export const api: ZeusApi = mockApi;   // -> supabaseApi
```

No component, hook or store file changes. The one exception is the login page,
which imports `SEED_CREDENTIALS` from `seed-data.ts` to render its "Demo
credentials" hint — deliberately, so the hint cannot drift from the password the
mock actually accepts. When `seed-data.ts` is deleted for Supabase the compiler
names that line; either drop the hint or hardcode whatever demo credentials
survive.

`mock-api.ts` itself is never imported outside `services/`, which is what makes
the data-access swap a one-line change.

**2. Auth** — `getSession` / `login` / `logout` map onto
`supabase.auth.getSession()`, `signInWithPassword` and `signOut()`. The mock's
`sessionStorage` flag disappears; `AuthGate` already treats `ready && user ===
null` as "signed out" and redirects, so it needs no edit. Username login becomes
email login unless the `username` column is kept.

**3. Realtime** — `onUpdate(listener)` is the whole contract. Replace the 4s
timer with a `postgres_changes` channel on `devices` and `accounts`, filtered to
the signed-in user, and call `listener({ device })` / `listener({ account })` per
payload. The store's patch-by-id logic and its identical-value bail-out are
already correct for a real feed, so no store change is needed. The `Update`
payload is deliberately the same shape Supabase emits — one row, keyed by id.

`refreshDevice` currently invents new numbers. Against Supabase it should read
the row instead, since the agent owns the real heartbeat.

**4. noVNC** — `connectViewer` should return a real tunnel URL and
`transport: "novnc"`. `ViewerSurface` then attaches an `RFB` instance to
`session.url` inside the existing `aspect-video` frame; the placeholder branch
keeps serving `transport: "mock"`. `ViewerSession.url` and `reason` already exist
for this, so no type change is required.

Table names assumed by the mock: `users`, `devices`, `accounts`, `commands`.
Column names in `lib/types.ts` already match them, and `Command` is the write
intent the agent drains — `sendCommand` becomes an insert into `commands` plus a
subscription to its row.

## Conventions worth keeping

- **Semantic tokens only.** Colours come from `--surface`, `--border`,
  `--accent`, `--online`, `--danger`, … in `globals.css`. No hex values in
  components. Status colour lives solely in `ui/status.tsx`, so a new state
  cannot drift into a second palette.
- **`--accent-fill` is not redundant.** `--accent` (`#4c8dff`) reaches 6.1:1 as
  text but only 3.2:1 under a white label. Filled buttons use the darker
  `--accent-fill` (`#2f6fe0`, 4.7:1). Text and borders keep `--accent`.
- **Statuses are exhaustive by type.** `Record<DeviceStatus, Tone>` and
  `Record<AccountStatus, Tone>` make a new union member a compile error until it
  is styled — which is how the filter-chip gap below was found.
- **Client pages cannot call `notFound()`** reliably, so an unmatched route param
  renders `NotFoundPanel`.
- **Derived chips.** The account list builds its filter chips from statuses
  actually present, so per-status counts always sum to "All" and no status is
  unfilterable. An earlier hardcoded list omitted `starting`, `restarting` and
  `offline`, which both broke that sum and made those accounts unreachable by
  filter.

## Verification performed

```
npx tsc --noEmit     clean, strict
npm run lint         0 errors, 0 warnings (--max-warnings=0)
npm run build        7 routes, static + dynamic, no errors
```

Smoke-tested in a real browser at 1440×900 and 390×844:

- Login: wrong password → inline error + error toast, stays on `/login`;
  correct → redirect to `/`.
- Commands: spinner + disabled button during latency, status transition,
  success toast. Restart on the `error` account → failure toast, account stays
  in `error` and gains a Start button.
- Offline device: warning banner, actions disabled, viewer Connect disabled.
- Config: dirty tracking, per-field validation blocking save, over-commit
  rejection, successful save, Reset.
- Viewer: connect → placeholder switches to connected state with the mock
  transport note; disconnect → back to "No session active".
- Filters: counts reconcile (All 4 = Running 2 + Starting 1 + Error 1); after
  stopping the only `starting` account its chip disappears and the selection
  falls back to All.
- Not-found: bogus device id renders the panel with a back link.
- Mobile: sidebar hidden, drawer opens with backdrop and closes on navigation,
  no horizontal overflow on any page, 2-column counter grid, stacked cards.
- Contrast: measured, not estimated — text pairings ≥4.5:1, non-text
  components ≥3:1.

Two contrast failures found this way were fixed (`--accent-fill`, `--offline`
raised from `#6b7280` to `#8b929e`, 3.4:1 → 5.0:1).
