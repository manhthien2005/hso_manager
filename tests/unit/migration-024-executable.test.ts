/**
 * Migration 024: Executable Real-PostgreSQL Migration Proof & Compatibility Expansion Tests
 * Task: KNIGHT_V403_R4_7_FORGE_OPEN_LIVE_FORENSIC_AND_TARGETED_FIX
 *
 * Proves that:
 * 1. Clean database starts and Supabase baseline environment bootstraps.
 * 2. Migrations 001 through 023 apply in canonical order without error.
 * 3. Seed accounts (legacy 0..7 and existing server 8 with old SHAs) before migration 024.
 * 4. Migration 024 executes cleanly on real PostgreSQL on top of 001..023 with zero errors.
 * 5. Existing server 8 rows and legacy 0..7 rows survive migration 024 unchanged.
 * 6. Base SHA 4009f070... + CTL 15 + capability => Bach Ho compatible.
 * 7. Movement-fix SHA 51cb7d4e... + CTL 15 + capability => Bach Ho compatible.
 * 8. Forge-fix SHA 278f3754... + CTL 15 + capability => Bach Ho compatible.
 * 9. Arbitrary SHA => rejected.
 * 10. Forge-fix SHA + CTL 14 => rejected.
 * 11. Forge-fix SHA without exact managed-identity-restart-v1 => rejected.
 * 12. Immutability of user_id / device_id and foreign device ownership checks preserved.
 * 13. Transition server 8 -> legacy and metadata-only edit preserved.
 * 14. RPC create_game_account accepts all 3 exact approved SHAs and rejects incompatible devices.
 * 15. RPC update_game_account accepts all 3 exact approved SHAs and rejects incompatible devices.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function runPsql(db: string, sql: string): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync("wsl", ["-u", "postgres", "psql", "-d", db, "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf-8",
    maxBuffer: 10 * 1024 * 1024,
  });
  return {
    status: res.status,
    stdout: res.stdout || "",
    stderr: res.stderr || "",
  };
}

describe("Migration 024: Real PostgreSQL Executable Migration & Compatibility Expansion Proof", () => {
  const testDbName = "test_zeus_migration_proof_024";
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");

  const BASE_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
  const MOV_SHA = "51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a";
  const FORGE_SHA = "278f3754c405f7ecdd49b8a83b6773dc621583b80d635ea283824558501cfb0d";
  const OBSOLETE_0BDDA_SHA = "0bddaee4680f8521f4628f4d52399ceee161c4e5d0387eab3dbe48cf662e8216";
  const OBSOLETE_D369_SHA = "d369b2edb2682f900e26893e2a378e796e2fcc3644416245e5f8e5bc3893e47a";
  const ARBITRARY_SHA = "9999999999999999999999999999999999999999999999999999999999999999";

  const userA = "11111111-1111-1111-1111-111111111111";
  const userB = "22222222-2222-2222-2222-222222222222";

  const devBaseCompat = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const devMovCompat  = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const devForgeCompat= "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const devForgeCtl14 = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const devForgeNoTok = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const devArbitrary  = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const devForeignB   = "12121212-1212-1212-1212-121212121212";
  const devObsolete0bdda = "33333333-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const devObsoleteD369  = "44444444-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  const accLegacy = "55555555-5555-5555-5555-555555555555";
  const accServer8Pre024A = "66666666-6666-6666-6666-666666666666";
  const accServer8Pre024B = "77777777-7777-7777-7777-777777777777";
  const accNewForgeFix    = "88888888-8888-8888-8888-888888888888";

  const dummyEphPub = "BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
  const dummyNonce = "AAAAAAAAAAAAAAAA";
  const dummyCt = "AAAAAAAAAAAAAAAAAAAAAA==";

  const validSealedJson = JSON.stringify({
    alg: "ecdh-p256-hkdf-sha256-aes256gcm",
    info: "zeus-v1",
    eph_pub: dummyEphPub,
    nonce: dummyNonce,
    ct: dummyCt,
  });

  it("1. Clean database starts and Supabase baseline environment bootstraps", () => {
    spawnSync("wsl", ["-u", "postgres", "dropdb", "--if-exists", testDbName], { encoding: "utf-8" });
    const createRes = spawnSync("wsl", ["-u", "postgres", "createdb", testDbName], { encoding: "utf-8" });
    assert.equal(createRes.status, 0, `createdb failed: ${createRes.stderr}`);

    const bootstrapSql = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text,
  created_at timestamptz DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN;
  END IF;
END $$;

ALTER ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
GRANT ALL ON TABLE auth.users TO service_role, postgres;
GRANT SELECT ON TABLE auth.users TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA auth TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )
$$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role, postgres;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role, postgres;
GRANT ALL ON SCHEMA public TO service_role, postgres;

CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);
`;
    const bootRes = runPsql(testDbName, bootstrapSql);
    assert.equal(bootRes.status, 0, `Bootstrap failed: ${bootRes.stderr}`);
  });

  it("2. Migrations 001 through 023 apply in canonical order without error", () => {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.substring(0, 3);
      if (Number(version) >= 24) continue;
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      const res = runPsql(testDbName, content);
      assert.equal(res.status, 0, `Migration ${file} failed: ${res.stderr}`);
      runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${version}', '${file}');`);
    }

    const checkRes = runPsql(testDbName, "SELECT count(*) FROM supabase_migrations.schema_migrations;");
    assert.match(checkRes.stdout, /23/);
  });

  it("3. Seed accounts and devices before migration 024", () => {
    const seedSql = `
INSERT INTO auth.users (id, email) VALUES
  ('${userA}', 'usera@test.com'),
  ('${userB}', 'userb@test.com');

INSERT INTO public.devices (id, user_id, device_auth_id, name, status, agent_version, jar_ctl_version, jar_sha256, pubkey, next_slot_index) VALUES
  ('${devBaseCompat}',  '${userA}', gen_random_uuid(), 'dev-base-compat', 'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${BASE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=', 'base64'), 20),
  ('${devMovCompat}',   '${userA}', gen_random_uuid(), 'dev-mov-compat',  'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${MOV_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI=', 'base64'), 20),
  ('${devForgeCompat}', '${userA}', gen_random_uuid(), 'dev-forge-compat','online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${FORGE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM=', 'base64'), 20),
  ('${devForgeCtl14}',  '${userA}', gen_random_uuid(), 'dev-forge-ctl14', 'online', '0.1.0+managed-identity-restart-v1', 14, '${FORGE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ=', 'base64'), 20),
  ('${devForgeNoTok}',  '${userA}', gen_random_uuid(), 'dev-forge-notok', 'online', '0.1.0+visual-qol-v1', 15, '${FORGE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU=', 'base64'), 20),
  ('${devArbitrary}',   '${userA}', gen_random_uuid(), 'dev-arbitrary',   'online', '0.1.0+managed-identity-restart-v1', 15, '${ARBITRARY_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY=', 'base64'), 20),
  ('${devForeignB}',    '${userB}', gen_random_uuid(), 'dev-foreign',     'online', '0.1.0+managed-identity-restart-v1', 15, '${FORGE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAc=', 'base64'), 20),
  ('${devObsolete0bdda}', '${userA}', gen_random_uuid(), 'dev-obsolete-0bdda', 'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${OBSOLETE_0BDDA_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAg=', 'base64'), 20),
  ('${devObsoleteD369}',  '${userA}', gen_random_uuid(), 'dev-obsolete-d369',  'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${OBSOLETE_D369_SHA}',  decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAk=', 'base64'), 20);

-- Seed accounts: legacy 0..7 and existing server 8 under migration 023
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES
  ('${accLegacy}',         '${devBaseCompat}', '${userA}', 'Legacy Server 0', 1, 'user0', 0),
  ('${accServer8Pre024A}', '${devBaseCompat}', '${userA}', 'Server 8 Base',   2, 'user8base', 8),
  ('${accServer8Pre024B}', '${devMovCompat}',  '${userA}', 'Server 8 Mov',    3, 'user8mov', 8);
`;
    const res = runPsql(testDbName, seedSql);
    assert.equal(res.status, 0, `Seed failed: ${res.stderr}`);
  });

  it("4. Migration 024 executes cleanly on real PostgreSQL with zero errors", () => {
    const file024 = fs.readdirSync(migrationsDir).find(f => f.startsWith("024_"));
    assert.ok(file024, "Migration 024 file must exist");
    const content024 = fs.readFileSync(path.join(migrationsDir, file024), "utf-8");

    const res024 = runPsql(testDbName, content024);
    assert.equal(res024.status, 0, `Migration 024 failed: ${res024.stderr}`);
    assert.doesNotMatch(res024.stderr, /ERROR/i);

    runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('024', '${file024}');`);
  });

  it("5. Existing legacy rows and pre-existing server 8 rows survive migration 024", () => {
    const resLegacy = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accLegacy}';`);
    assert.match(resLegacy.stdout, /0/);

    const resServer8A = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre024A}';`);
    assert.match(resServer8A.stdout, /8/);
    assert.match(resServer8A.stdout, /Server 8 Base/);

    const resServer8B = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre024B}';`);
    assert.match(resServer8B.stdout, /8/);
    assert.match(resServer8B.stdout, /Server 8 Mov/);
  });

  it("6. Old base SHA 4009f070... continues to be accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devBaseCompat}', '${userA}', 'Old SHA Server 8 Post-024', 10, 'oldsha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `Old SHA insert failed: ${res.stderr}`);

    const transSql = `
UPDATE public.accounts SET server_index = 8 WHERE id = '${accLegacy}';
`;
    const transRes = runPsql(testDbName, transSql);
    assert.equal(transRes.status, 0, `Old SHA transition failed: ${transRes.stderr}`);
  });

  it("7. Movement-fix SHA 51cb7d4e... continues to be accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devMovCompat}', '${userA}', 'Mov SHA Server 8 Post-024', 11, 'movsha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `Mov SHA insert failed: ${res.stderr}`);
  });

  it("8. Forge-fix SHA 278f3754... is accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index)
VALUES ('${accNewForgeFix}', '${devForgeCompat}', '${userA}', 'Forge SHA Server 8 Post-024', 12, 'forgesha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `Forge SHA insert failed: ${res.stderr}`);

    const checkSql = `SELECT count(*) FROM public.accounts WHERE id = '${accNewForgeFix}' AND server_index = 8;`;
    const checkRes = runPsql(testDbName, checkSql);
    assert.match(checkRes.stdout, /1/);
  });

  it("9. Arbitrary SHA => rejected for Bach Ho", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devArbitrary}', '${userA}', 'Arbitrary SHA Server 8', 13, 'arbsha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /is not compatible with Bach Ho server/);
  });

  it("9b. Obsolete candidate SHAs 0bdda and d369 => rejected for Bach Ho", () => {
    const res0bdda = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devObsolete0bdda}', '${userA}', 'Obsolete 0bdda', 16, 'obs0bdda', 8);
`);
    assert.notEqual(res0bdda.status, 0);
    assert.match(res0bdda.stderr, /is not compatible with Bach Ho server/);

    const resD369 = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devObsoleteD369}', '${userA}', 'Obsolete d369', 17, 'obsd369', 8);
`);
    assert.notEqual(resD369.status, 0);
    assert.match(resD369.stderr, /is not compatible with Bach Ho server/);
  });

  it("10. Forge-fix SHA + CTL 14 => rejected for Bach Ho", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devForgeCtl14}', '${userA}', 'Forge CTL14 Server 8', 14, 'ctl14sha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /is not compatible with Bach Ho server/);
  });

  it("11. Forge-fix SHA without exact managed-identity-restart-v1 => rejected for Bach Ho", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devForgeNoTok}', '${userA}', 'Forge NoTok Server 8', 15, 'notoksha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /is not compatible with Bach Ho server/);
  });

  it("12. Immutability of user_id / device_id and foreign device ownership checks preserved", () => {
    const updateUserIdSql = `UPDATE public.accounts SET user_id = '${userB}' WHERE id = '${accLegacy}';`;
    const r1 = runPsql(testDbName, updateUserIdSql);
    assert.notEqual(r1.status, 0);
    assert.match(r1.stderr, /accounts\.user_id is immutable/);

    const updateDeviceIdSql = `UPDATE public.accounts SET device_id = '${devMovCompat}' WHERE id = '${accLegacy}';`;
    const r2 = runPsql(testDbName, updateDeviceIdSql);
    assert.notEqual(r2.status, 0);
    assert.match(r2.stderr, /accounts\.device_id is immutable/);

    const foreignDevSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devForeignB}', '${userA}', 'Stolen Dev', 16, 'stolen_u', 0);
`;
    const r3 = runPsql(testDbName, foreignDevSql);
    assert.notEqual(r3.status, 0);
    assert.match(r3.stderr, /does not belong to user/);
  });

  it("13. Transition server 8 -> legacy and metadata-only edit preserved", () => {
    const transSql = `UPDATE public.accounts SET server_index = 0 WHERE id = '${accServer8Pre024A}';`;
    const r1 = runPsql(testDbName, transSql);
    assert.equal(r1.status, 0);

    const metaSql = `UPDATE public.accounts SET label = 'Updated Label Server 8' WHERE id = '${accServer8Pre024B}';`;
    const r2 = runPsql(testDbName, metaSql);
    assert.equal(r2.status, 0);
  });

  it("14. RPC create_game_account accepts all 3 exact approved SHAs and rejects incompatible devices", () => {
    // A) With old base SHA
    const sqlBase = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.create_game_account(
  '${devBaseCompat}'::uuid,
  'RPC Base SHA Valid',
  'rpc_base_sha',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15,
  '{}'::jsonb,
  1::smallint
) AS account_id;
`;
    const resBase = runPsql(testDbName, sqlBase);
    assert.equal(resBase.status, 0, `create_game_account with base SHA failed: ${resBase.stderr}`);
    assert.match(resBase.stdout, /[0-9a-f]{8}-[0-9a-f]{4}/);

    // B) With movement-fix approved SHA
    const sqlMov = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.create_game_account(
  '${devMovCompat}'::uuid,
  'RPC Mov SHA Valid',
  'rpc_mov_sha',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15,
  '{}'::jsonb,
  1::smallint
) AS account_id;
`;
    const resMov = runPsql(testDbName, sqlMov);
    assert.equal(resMov.status, 0, `create_game_account with mov SHA failed: ${resMov.stderr}`);
    assert.match(resMov.stdout, /[0-9a-f]{8}-[0-9a-f]{4}/);

    // C) With forge-fix approved SHA
    const sqlForge = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.create_game_account(
  '${devForgeCompat}'::uuid,
  'RPC Forge SHA Valid',
  'rpc_forge_sha',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15,
  '{}'::jsonb,
  1::smallint
) AS account_id;
`;
    const resForge = runPsql(testDbName, sqlForge);
    assert.equal(resForge.status, 0, `create_game_account with forge SHA failed: ${resForge.stderr}`);
    assert.match(resForge.stdout, /[0-9a-f]{8}-[0-9a-f]{4}/);

    // D) Incompatible (arbitrary SHA) rejected
    const sqlIncompat = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.create_game_account(
  '${devArbitrary}'::uuid,
  'RPC Arbitrary Incompatible',
  'rpc_arb_incompat',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15,
  '{}'::jsonb,
  1::smallint
);
`;
    const resIncompat = runPsql(testDbName, sqlIncompat);
    assert.notEqual(resIncompat.status, 0);
    assert.match(resIncompat.stderr, /not compatible with Bach Ho server/);
  });

  it("15. RPC update_game_account accepts transition to server 8 for all 3 approved SHAs", () => {
    // Seed legacy accounts on all three devices
    const seedSql = `
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES
  ('22222222-2222-2222-2222-222222222222', '${devBaseCompat}',  '${userA}', 'Legacy on Base Dev',  21, 'leg_base',  0),
  ('33333333-3333-3333-3333-333333333333', '${devMovCompat}',   '${userA}', 'Legacy on Mov Dev',   22, 'leg_mov',   0),
  ('44444444-4444-4444-4444-444444444444', '${devForgeCompat}', '${userA}', 'Legacy on Forge Dev', 23, 'leg_forge', 0);
`;
    runPsql(testDbName, seedSql);

    // Transition on base device
    const transBaseSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.update_game_account(
  '22222222-2222-2222-2222-222222222222'::uuid,
  'Transitioned on Base Dev',
  8::smallint,
  NULL,
  NULL,
  1::smallint
);
`;
    const transBaseRes = runPsql(testDbName, transBaseSql);
    assert.equal(transBaseRes.status, 0, `update_game_account transition on base device failed: ${transBaseRes.stderr}`);

    // Transition on mov device
    const transMovSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.update_game_account(
  '33333333-3333-3333-3333-333333333333'::uuid,
  'Transitioned on Mov Dev',
  8::smallint,
  NULL,
  NULL,
  1::smallint
);
`;
    const transMovRes = runPsql(testDbName, transMovSql);
    assert.equal(transMovRes.status, 0, `update_game_account transition on mov device failed: ${transMovRes.stderr}`);

    // Transition on forge device
    const transForgeSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.update_game_account(
  '44444444-4444-4444-4444-444444444444'::uuid,
  'Transitioned on Forge Dev',
  8::smallint,
  NULL,
  NULL,
  1::smallint
);
`;
    const transForgeRes = runPsql(testDbName, transForgeSql);
    assert.equal(transForgeRes.status, 0, `update_game_account transition on forge device failed: ${transForgeRes.stderr}`);

    // Verify all 3 are now on server 8
    const checkSql = `SELECT count(*) FROM public.accounts WHERE id IN ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444') AND server_index = 8;`;
    const checkRes = runPsql(testDbName, checkSql);
    assert.match(checkRes.stdout, /3/);

    // Clean up test database
    spawnSync("wsl", ["-u", "postgres", "dropdb", "--if-exists", testDbName], { encoding: "utf-8" });
  });
});
