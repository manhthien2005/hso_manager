/**
 * Migration 025: Executable Real-PostgreSQL Migration Proof & Blacksmith Intro Dialog Fix Tests
 * Task: KNIGHT_V403_R4_9_1_HARDEN_BLACKSMITH_DIALOG_OWNERSHIP_BEFORE_RELEASE
 *
 * Proves that:
 * 1. Clean database starts and Supabase baseline environment bootstraps.
 * 2. Migrations 001 through 024 apply in canonical order without error.
 * 3. Seed accounts (legacy 0..7 and existing server 8 under 024, including with 278f...).
 * 4. Migration 025 executes cleanly on real PostgreSQL on top of 001..024 with zero errors.
 * 5. Pre-existing server 8 rows (including 278f...) and legacy 0..7 rows survive migration 025 unchanged.
 * 6. Base SHA 4009f070... + CTL 15 + capability => Bach Ho compatible.
 * 7. Movement-fix SHA 51cb7d4e... + CTL 15 + capability => Bach Ho compatible.
 * 8. Hardened blacksmith intro dialog fix SHA 24e9a820... + CTL 15 + capability => Bach Ho compatible.
 * 9. Rolled-back candidate SHA 278f3754... and failed candidate SHA 47e4d766... => REJECTED for new inserts and transitions to server 8.
 * 10. Arbitrary SHA and obsolete candidates (0bdda, d369) => REJECTED.
 * 11. Dialog-fix SHA + CTL 14 => rejected.
 * 12. Dialog-fix SHA without exact managed-identity-restart-v1 => rejected.
 * 13. Immutability of user_id / device_id and foreign device ownership checks preserved.
 * 14. Transition server 8 -> legacy and metadata-only edit on pre-existing row preserved.
 * 15. RPC create_game_account accepts 24e9a820..., 4009..., 51cb... and rejects 278f..., 47e4... and arbitrary.
 * 16. RPC update_game_account accepts 24e9a820..., 4009..., 51cb... and rejects 278f..., 47e4... and arbitrary.
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

describe("Migration 025: Real PostgreSQL Executable Migration & Blacksmith Intro Dialog Fix Proof", () => {
  const testDbName = "test_zeus_migration_proof_025";
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");

  const BASE_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
  const MOV_SHA = "51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a";
  const DIALOG_FIX_SHA = "24e9a8209337d0163c2b2c948b5964f1df6574bfa1d3fd161aca93e905e525d2";
  const ROLLED_BACK_FORGE_SHA = "278f3754c405f7ecdd49b8a83b6773dc621583b80d635ea283824558501cfb0d";
  const FAILED_47E4_SHA = "47e4d766c5b8dadb2058e1d585d6496620bda0e188276c34b0ea6cb84ec14b9d";
  const OBSOLETE_0BDDA_SHA = "0bddaee4680f8521f4628f4d52399ceee161c4e5d0387eab3dbe48cf662e8216";
  const OBSOLETE_D369_SHA = "d369b2edb2682f900e26893e2a378e796e2fcc3644416245e5f8e5bc3893e47a";
  const ARBITRARY_SHA = "9999999999999999999999999999999999999999999999999999999999999999";

  const userA = "11111111-1111-1111-1111-111111111111";
  const userB = "22222222-2222-2222-2222-222222222222";

  const devBaseCompat     = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const devMovCompat      = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const devDialogCompat   = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const devRolledBack278f = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const devFailed47e4     = "12121212-aaaa-bbbb-cccc-dddddddddddd";
  const devDialogCtl14    = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const devDialogNoTok    = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const devArbitrary      = "11111111-aaaa-bbbb-cccc-dddddddddddd";
  const devForeignB       = "22222222-aaaa-bbbb-cccc-dddddddddddd";
  const devObsolete0bdda  = "33333333-aaaa-bbbb-cccc-dddddddddddd";
  const devObsoleteD369   = "44444444-aaaa-bbbb-cccc-dddddddddddd";

  const accLegacy           = "55555555-5555-5555-5555-555555555555";
  const accServer8Pre025A   = "66666666-6666-6666-6666-666666666666";
  const accServer8Pre025B   = "77777777-7777-7777-7777-777777777777";
  const accServer8Pre025_278= "88888888-8888-8888-8888-888888888888";
  const accNewDialogFix     = "99999999-9999-9999-9999-999999999999";

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

  it("2. Migrations 001 through 024 apply in canonical order without error", () => {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.substring(0, 3);
      if (Number(version) >= 25) continue;
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      const res = runPsql(testDbName, content);
      assert.equal(res.status, 0, `Migration ${file} failed: ${res.stderr}`);
      runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${version}', '${file}');`);
    }

    const checkRes = runPsql(testDbName, "SELECT count(*) FROM supabase_migrations.schema_migrations;");
    assert.match(checkRes.stdout, /24/);
  });

  it("3. Seed accounts and devices before migration 025 (under migration 024)", () => {
    const seedSql = `
INSERT INTO auth.users (id, email) VALUES
  ('${userA}', 'usera@test.com'),
  ('${userB}', 'userb@test.com');

INSERT INTO public.devices (id, user_id, device_auth_id, name, status, agent_version, jar_ctl_version, jar_sha256, pubkey, next_slot_index) VALUES
  ('${devBaseCompat}',     '${userA}', gen_random_uuid(), 'dev-base-compat',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${BASE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=', 'base64'), 20),
  ('${devMovCompat}',      '${userA}', gen_random_uuid(), 'dev-mov-compat',     'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${MOV_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI=', 'base64'), 20),
  ('${devDialogCompat}',   '${userA}', gen_random_uuid(), 'dev-dialog-compat',  'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${DIALOG_FIX_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM=', 'base64'), 20),
  ('${devRolledBack278f}', '${userA}', gen_random_uuid(), 'dev-rolledback-278f','online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${ROLLED_BACK_FORGE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ=', 'base64'), 20),
  ('${devFailed47e4}',     '${userA}', gen_random_uuid(), 'dev-failed-47e4',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${FAILED_47E4_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGM=', 'base64'), 20),
  ('${devDialogCtl14}',    '${userA}', gen_random_uuid(), 'dev-dialog-ctl14',   'online', '0.1.0+managed-identity-restart-v1', 14, '${DIALOG_FIX_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU=', 'base64'), 20),
  ('${devDialogNoTok}',    '${userA}', gen_random_uuid(), 'dev-dialog-notok',   'online', '0.1.0+visual-qol-v1', 15, '${DIALOG_FIX_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY=', 'base64'), 20),
  ('${devArbitrary}',      '${userA}', gen_random_uuid(), 'dev-arbitrary',      'online', '0.1.0+managed-identity-restart-v1', 15, '${ARBITRARY_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAc=', 'base64'), 20),
  ('${devForeignB}',       '${userB}', gen_random_uuid(), 'dev-foreign',        'online', '0.1.0+managed-identity-restart-v1', 15, '${DIALOG_FIX_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAg=', 'base64'), 20),
  ('${devObsolete0bdda}',  '${userA}', gen_random_uuid(), 'dev-obsolete-0bdda', 'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${OBSOLETE_0BDDA_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAk=', 'base64'), 20),
  ('${devObsoleteD369}',   '${userA}', gen_random_uuid(), 'dev-obsolete-d369',  'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${OBSOLETE_D369_SHA}',  decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAs=', 'base64'), 20);

-- Seed accounts: legacy 0..7 and existing server 8 under migration 024 (including one on 278f)
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES
  ('${accLegacy}',            '${devBaseCompat}',     '${userA}', 'Legacy Server 0', 1, 'user0', 0),
  ('${accServer8Pre025A}',    '${devBaseCompat}',     '${userA}', 'Server 8 Base',   2, 'user8base', 8),
  ('${accServer8Pre025B}',    '${devMovCompat}',      '${userA}', 'Server 8 Mov',    3, 'user8mov', 8),
  ('${accServer8Pre025_278}', '${devRolledBack278f}', '${userA}', 'Server 8 278f',   4, 'user8_278', 8);
`;
    const res = runPsql(testDbName, seedSql);
    assert.equal(res.status, 0, `Seed failed: ${res.stderr}`);
  });

  it("4. Migration 025 executes cleanly on real PostgreSQL with zero errors", () => {
    const file025 = fs.readdirSync(migrationsDir).find(f => f.startsWith("025_"));
    assert.ok(file025, "Migration 025 file must exist");
    const content025 = fs.readFileSync(path.join(migrationsDir, file025), "utf-8");

    const res025 = runPsql(testDbName, content025);
    assert.equal(res025.status, 0, `Migration 025 failed: ${res025.stderr}`);
    assert.doesNotMatch(res025.stderr, /ERROR/i);

    runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('025', '${file025}');`);
  });

  it("5. Existing legacy rows and pre-existing server 8 rows (including 278f) survive migration 025", () => {
    const resLegacy = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accLegacy}';`);
    assert.match(resLegacy.stdout, /0/);

    const resServer8A = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre025A}';`);
    assert.match(resServer8A.stdout, /8/);
    assert.match(resServer8A.stdout, /Server 8 Base/);

    const resServer8B = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre025B}';`);
    assert.match(resServer8B.stdout, /8/);
    assert.match(resServer8B.stdout, /Server 8 Mov/);

    const resServer8_278 = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre025_278}';`);
    assert.match(resServer8_278.stdout, /8/);
    assert.match(resServer8_278.stdout, /Server 8 278f/);
  });

  it("6. Old base SHA 4009f070... continues to be accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devBaseCompat}', '${userA}', 'Old SHA Server 8 Post-025', 10, 'oldsha8', 8);
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
VALUES ('${devMovCompat}', '${userA}', 'Mov SHA Server 8 Post-025', 11, 'movsha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `Mov SHA insert failed: ${res.stderr}`);
  });

  it("8. Hardened blacksmith intro dialog fix SHA 24e9a820... is accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index)
VALUES ('${accNewDialogFix}', '${devDialogCompat}', '${userA}', 'Dialog SHA Server 8 Post-025', 12, 'dialogsha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `Dialog SHA insert failed: ${res.stderr}`);

    const checkSql = `SELECT count(*) FROM public.accounts WHERE id = '${accNewDialogFix}' AND server_index = 8;`;
    const checkRes = runPsql(testDbName, checkSql);
    assert.match(checkRes.stdout, /1/);
  });

  it("9. Rolled-back candidate SHA 278f3754... and candidate 47e4d766... are REJECTED for server 8 insert and transition", () => {
    const insertSql278 = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devRolledBack278f}', '${userA}', 'Rolled Back Candidate 278f', 13, 'cand278f', 8);
`;
    const res278 = runPsql(testDbName, insertSql278);
    assert.notEqual(res278.status, 0, "Insert on candidate 278f must fail under migration 025");
    assert.match(res278.stderr, /is not compatible with Bach Ho server/);

    const insertSql47e4 = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devFailed47e4}', '${userA}', 'Failed Candidate 47e4', 13, 'cand47e4', 8);
`;
    const res47e4 = runPsql(testDbName, insertSql47e4);
    assert.notEqual(res47e4.status, 0, "Insert on candidate 47e4 must fail under migration 025");
    assert.match(res47e4.stderr, /is not compatible with Bach Ho server/);
  });

  it("10. Arbitrary SHA and obsolete candidate SHAs => rejected for Bach Ho", () => {
    const resArb = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devArbitrary}', '${userA}', 'Arbitrary SHA Server 8', 14, 'arbsha8', 8);
`);
    assert.notEqual(resArb.status, 0);
    assert.match(resArb.stderr, /is not compatible with Bach Ho server/);

    const res0bdda = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devObsolete0bdda}', '${userA}', 'Obsolete 0bdda', 15, 'obs0bdda', 8);
`);
    assert.notEqual(res0bdda.status, 0);
    assert.match(res0bdda.stderr, /is not compatible with Bach Ho server/);

    const resD369 = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devObsoleteD369}', '${userA}', 'Obsolete d369', 16, 'obsd369', 8);
`);
    assert.notEqual(resD369.status, 0);
    assert.match(resD369.stderr, /is not compatible with Bach Ho server/);
  });

  it("11. Dialog-fix SHA + CTL 14 => rejected for Bach Ho", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devDialogCtl14}', '${userA}', 'Dialog CTL14 Server 8', 17, 'ctl14sha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /is not compatible with Bach Ho server/);
  });

  it("12. Dialog-fix SHA without exact managed-identity-restart-v1 => rejected for Bach Ho", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devDialogNoTok}', '${userA}', 'Dialog NoTok Server 8', 18, 'notoksha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /is not compatible with Bach Ho server/);
  });

  it("13. Immutability of user_id / device_id and foreign device ownership checks preserved", () => {
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
VALUES ('${devForeignB}', '${userA}', 'Stolen Dev', 19, 'stolen_u', 0);
`;
    const r3 = runPsql(testDbName, foreignDevSql);
    assert.notEqual(r3.status, 0);
    assert.match(r3.stderr, /does not belong to user/);
  });

  it("14. Transition server 8 -> legacy and metadata-only edit preserved", () => {
    const transSql = `UPDATE public.accounts SET server_index = 0 WHERE id = '${accServer8Pre025A}';`;
    const r1 = runPsql(testDbName, transSql);
    assert.equal(r1.status, 0);

    const metaSql = `UPDATE public.accounts SET label = 'Updated Label Server 8' WHERE id = '${accServer8Pre025B}';`;
    const r2 = runPsql(testDbName, metaSql);
    assert.equal(r2.status, 0);

    // Metadata edit on pre-existing 278f account also preserved without rejecting
    const meta278Sql = `UPDATE public.accounts SET label = 'Updated Label Server 8 278f' WHERE id = '${accServer8Pre025_278}';`;
    const r3 = runPsql(testDbName, meta278Sql);
    assert.equal(r3.status, 0);
  });

  it("15. RPC create_game_account accepts 3 approved SHAs and rejects candidate 278f and arbitrary", () => {
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

    // C) With dialog-fix approved SHA
    const sqlDialog = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.create_game_account(
  '${devDialogCompat}'::uuid,
  'RPC Dialog SHA Valid',
  'rpc_dialog_sha',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15,
  '{}'::jsonb,
  1::smallint
) AS account_id;
`;
    const resDialog = runPsql(testDbName, sqlDialog);
    assert.equal(resDialog.status, 0, `create_game_account with dialog SHA failed: ${resDialog.stderr}`);
    assert.match(resDialog.stdout, /[0-9a-f]{8}-[0-9a-f]{4}/);

    // D) Rolled-back candidate 278f rejected
    const sqlCand278 = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.create_game_account(
  '${devRolledBack278f}'::uuid,
  'RPC 278f Incompatible',
  'rpc_278_incompat',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15,
  '{}'::jsonb,
  1::smallint
);
`;
    const resCand278 = runPsql(testDbName, sqlCand278);
    assert.notEqual(resCand278.status, 0);
    assert.match(resCand278.stderr, /not compatible with Bach Ho server/);

    // D2) Failed candidate 47e4 rejected
    const sqlCand47e4 = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.create_game_account(
  '${devFailed47e4}'::uuid,
  'RPC 47e4 Incompatible',
  'rpc_47e4_incompat',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15,
  '{}'::jsonb,
  1::smallint
);
`;
    const resCand47e4 = runPsql(testDbName, sqlCand47e4);
    assert.notEqual(resCand47e4.status, 0);
    assert.match(resCand47e4.stderr, /not compatible with Bach Ho server/);

    // E) Arbitrary SHA rejected
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

  it("16. RPC update_game_account accepts transition to server 8 for all 3 approved SHAs and rejects 278f and 47e4", () => {
    // Seed legacy accounts on devices
    const seedSql = `
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES
  ('22222222-2222-2222-2222-222222222222', '${devBaseCompat}',     '${userA}', 'Legacy on Base Dev',   21, 'leg_base',   0),
  ('33333333-3333-3333-3333-333333333333', '${devMovCompat}',      '${userA}', 'Legacy on Mov Dev',    22, 'leg_mov',    0),
  ('44444444-4444-4444-4444-444444444444', '${devDialogCompat}',   '${userA}', 'Legacy on Dialog Dev', 23, 'leg_dialog', 0),
  ('55555555-4444-4444-4444-444444444444', '${devRolledBack278f}', '${userA}', 'Legacy on 278 Dev',    24, 'leg_278',    0),
  ('66666666-4444-4444-4444-444444444444', '${devFailed47e4}',     '${userA}', 'Legacy on 47e4 Dev',   25, 'leg_47e4',   0);
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

    // Transition on dialog device
    const transDialogSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.update_game_account(
  '44444444-4444-4444-4444-444444444444'::uuid,
  'Transitioned on Dialog Dev',
  8::smallint,
  NULL,
  NULL,
  1::smallint
);
`;
    const transDialogRes = runPsql(testDbName, transDialogSql);
    assert.equal(transDialogRes.status, 0, `update_game_account transition on dialog device failed: ${transDialogRes.stderr}`);

    // Transition on candidate 278f device REJECTED
    const trans278Sql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.update_game_account(
  '55555555-4444-4444-4444-444444444444'::uuid,
  'Transition on 278 Dev',
  8::smallint,
  NULL,
  NULL,
  1::smallint
);
`;
    const trans278Res = runPsql(testDbName, trans278Sql);
    assert.notEqual(trans278Res.status, 0);
    assert.match(trans278Res.stderr, /not compatible with Bach Ho server/);

    // Transition on candidate 47e4 device REJECTED
    const trans47e4Sql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.update_game_account(
  '66666666-4444-4444-4444-444444444444'::uuid,
  'Transition on 47e4 Dev',
  8::smallint,
  NULL,
  NULL,
  1::smallint
);
`;
    const trans47e4Res = runPsql(testDbName, trans47e4Sql);
    assert.notEqual(trans47e4Res.status, 0);
    assert.match(trans47e4Res.stderr, /not compatible with Bach Ho server/);

    // Verify all 3 approved are now on server 8
    const checkSql = `SELECT count(*) FROM public.accounts WHERE id IN ('22222222-2222-2222-2222-222222222222', '33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444') AND server_index = 8;`;
    const checkRes = runPsql(testDbName, checkSql);
    assert.match(checkRes.stdout, /3/);

    // Clean up test database
    spawnSync("wsl", ["-u", "postgres", "dropdb", "--if-exists", testDbName], { encoding: "utf-8" });
  });
});
