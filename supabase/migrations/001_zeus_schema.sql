-- =============================================================================
-- Zeus Knight Cloud — Database Schema (Task 6)
-- Run toan bo file nay trong Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wuyxkksihkmsmwuiuvdk/sql/new
-- =============================================================================

-- 1. Tables -------------------------------------------------------------------

create table if not exists devices (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid references auth.users,
  pair_code             text unique,
  name                  text not null default 'knight-node',
  pubkey                bytea,
  agent_version         text,
  jar_sha256            text,
  jar_ctl_version       int,
  jar_snapshot_version  int,
  jar_ctl_key_count     int,
  status                text not null default 'offline',
  cpu_pct               real,
  ram_used_mb           int,
  ram_total_mb          int,
  uptime_s              int,
  viewer_url            text,
  viewer_expires_at     timestamptz,
  last_seen             timestamptz,
  created_at            timestamptz not null default now()
);

create table if not exists accounts (
  id              uuid primary key default gen_random_uuid(),
  device_id       uuid not null references devices on delete cascade,
  user_id         uuid not null references auth.users,
  label           text not null,
  slot_index      int  not null,
  username        text not null,
  secret_sealed   jsonb not null default '{}',
  server_index    smallint not null default 0,
  desired_state   text not null default 'stopped',
  runtime         jsonb not null default '{"heap_max_mib":320,"headless":false,"autostart":true}',
  control_version int  not null default 13,
  control         jsonb not null default '{}',
  config_version  int  not null default 1,
  updated_at      timestamptz not null default now(),
  unique (device_id, slot_index)
);

create table if not exists account_runtime (
  account_id        uuid primary key references accounts on delete cascade,
  process_state     text not null default 'stopped',
  pid               int,
  ram_mb            int,
  cpu_pct           real,
  snapshot_version  int,
  snapshot          jsonb,
  config_status     text,
  config_error      text,
  applied_version   int,
  restarts          int not null default 0,
  updated_at        timestamptz not null default now()
);

create table if not exists commands (
  id          uuid primary key default gen_random_uuid(),
  device_id   uuid not null references devices on delete cascade,
  account_id  uuid references accounts on delete cascade,
  type        text not null,
  payload     jsonb,
  status      text not null default 'queued',
  message     text,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '5 minutes',
  finished_at timestamptz
);

-- 2. Indexes ------------------------------------------------------------------

create index if not exists idx_accounts_device_id     on accounts (device_id);
create index if not exists idx_commands_device_queued on commands (device_id, status) where status = 'queued';
create index if not exists idx_runtime_updated        on account_runtime (updated_at);
create index if not exists idx_devices_pair_code      on devices (pair_code) where pair_code is not null;

-- 3. Row Level Security -------------------------------------------------------

alter table devices         enable row level security;
alter table accounts        enable row level security;
alter table account_runtime enable row level security;
alter table commands        enable row level security;

drop policy if exists own_devices  on devices;
drop policy if exists own_accounts on accounts;
drop policy if exists own_runtime  on account_runtime;
drop policy if exists own_commands on commands;

create policy own_devices  on devices  using (user_id = auth.uid());
create policy own_accounts on accounts using (user_id = auth.uid());
create policy own_runtime  on account_runtime using (
  exists (select 1 from accounts a where a.id = account_id and a.user_id = auth.uid())
);
create policy own_commands on commands using (
  exists (select 1 from devices d where d.id = device_id and d.user_id = auth.uid())
);

-- 4. RPC claim_device ---------------------------------------------------------
-- Duong duy nhat de gan user_id cho device khi pair.

create or replace function claim_device(
  code text,
  device_name text,
  device_pubkey bytea
)
returns uuid language plpgsql security definer as $$
declare
  d uuid;
begin
  update devices
     set user_id   = auth.uid(),
         name      = device_name,
         pubkey    = device_pubkey,
         pair_code = null
   where pair_code = code
     and user_id is null
  returning id into d;

  if d is null then
    raise exception 'invalid or already claimed pair code';
  end if;

  return d;
end $$;

-- 5. Realtime -----------------------------------------------------------------
-- Bat realtime cho 4 bang. Bat buoc — khong co realtime thi agent khong nhan command.

alter publication supabase_realtime add table devices, accounts, account_runtime, commands;
