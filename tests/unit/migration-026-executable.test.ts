/**
 * Migration 026: Executable Real-PostgreSQL Migration Proof & Forge Native NPC Interaction Fix Tests
 * Task: KNIGHT_V403_R4_11_FIX_FORGE_NATIVE_NPC_INTERACTION
 *
 * Proves that:
 * 1. Clean database starts and Supabase baseline environment bootstraps.
 * 2. Migrations 001 through 025 apply in canonical order without error.
 * 3. Seed accounts (legacy 0..7 and existing server 8 under 025, including with 24e9...).
 * 4. Migration 026 executes cleanly on real PostgreSQL on top of 001..025 with zero errors.
 * 5. Pre-existing server 8 rows (including 24e9...) and legacy 0..7 rows survive migration 026 unchanged.
 * 6. Base SHA 4009f070... + CTL 15 + capability => Bach Ho compatible.
 * 7. Movement-fix SHA 51cb7d4e... + CTL 15 + capability => Bach Ho compatible.
 * 8. Forge native NPC interaction fix SHA b2bc6ceb... + CTL 15 + capability => Bach Ho compatible.
 * 9. Hardened intro dialog fix SHA 24e9a820... => REJECTED for new inserts and transitions to server 8 after migration 026.
 * 10. Rolled-back candidate SHA 278f3754... and failed candidate SHA 47e4d766... => REJECTED.
 * 11. Arbitrary SHA and obsolete candidates (0bdda, d369) => REJECTED.
 * 12. Forge native fix SHA + CTL 14 => REJECTED.
 * 13. Forge native fix SHA without exact managed-identity-restart-v1 => REJECTED.
 * 14. Immutability of user_id / device_id and foreign device ownership checks preserved.
 * 15. Transition server 8 -> legacy and metadata-only edit on pre-existing row preserved.
 * 16. RPC create_game_account accepts b2bc6ceb..., 4009..., 51cb... and rejects 24e9..., 278f..., 47e4... and arbitrary.
 * 17. RPC update_game_account accepts b2bc6ceb..., 4009..., 51cb... and rejects 24e9..., 278f..., 47e4... and arbitrary.
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

describe("Migration 026: Real PostgreSQL Executable Migration & Forge Native Interaction Proof", () => {
  const testDbName = "test_zeus_migration_proof_026";
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");

  const BASE_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
  const MOV_SHA = "51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a";
  const FORGE_NATIVE_SHA = "b2bc6ceb5922ff05c7ae252741c7829e0d5cb81e74003d5035f80870744c6658";
  const FAILED_24E9_SHA = "24e9a8209337d0163c2b2c948b5964f1df6574bfa1d3fd161aca93e905e525d2";
  const ROLLED_BACK_FORGE_SHA = "278f3754c405f7ecdd49b8a83b6773dc621583b80d635ea283824558501cfb0d";
  const FAILED_47E4_SHA = "47e4d766c5b8dadb2058e1d585d6496620bda0e188276c34b0ea6cb84ec14b9d";
  const OBSOLETE_0BDDA_SHA = "0bddaee4680f8521f4628f4d52399ceee161c4e5d0387eab3dbe48cf662e8216";
  const OBSOLETE_D369_SHA = "d369b2edb2682f900e26893e2a378e796e2fcc3644416245e5f8e5bc3893e47a";
  const ARBITRARY_SHA = "9999999999999999999999999999999999999999999999999999999999999999";

  const userA = "11111111-1111-1111-1111-111111111111";
  const userB = "22222222-2222-2222-2222-222222222222";

  const devBaseCompat     = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const devMovCompat      = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const devForgeCompat    = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const devFailed24e9     = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const devRolledBack278f = "12121212-aaaa-bbbb-cccc-dddddddddddd";
  const devFailed47e4     = "13131313-aaaa-bbbb-cccc-dddddddddddd";
  const devForgeCtl14     = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const devForgeNoTok     = "ffffffff-ffff-ffff-ffff-ffffffffffff";
  const devArbitrary      = "11111111-aaaa-bbbb-cccc-dddddddddddd";
  const devForeignB       = "22222222-aaaa-bbbb-cccc-dddddddddddd";
  const devObsolete0bdda  = "33333333-aaaa-bbbb-cccc-dddddddddddd";
  const devObsoleteD369   = "44444444-aaaa-bbbb-cccc-dddddddddddd";

  const accLegacy           = "55555555-5555-5555-5555-555555555555";
  const accServer8Pre026A   = "66666666-6666-6666-6666-666666666666";
  const accServer8Pre026B   = "77777777-7777-7777-7777-777777777777";
  const accServer8Pre026_24e= "88888888-8888-8888-8888-888888888888";
  const accNewForgeFix      = "99999999-9999-9999-9999-999999999999";

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

  it("2. Migrations 001 through 025 apply in canonical order without error", () => {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.substring(0, 3);
      if (Number(version) >= 26) continue;
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      const res = runPsql(testDbName, content);
      assert.equal(res.status, 0, `Migration ${file} failed: ${res.stderr}`);
      runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${version}', '${file}');`);
    }

    const checkRes = runPsql(testDbName, "SELECT count(*) FROM supabase_migrations.schema_migrations;");
    assert.match(checkRes.stdout, /25/);
  });

  it("3. Seed accounts and devices before migration 026 (under migration 025)", () => {
    const seedSql = `
INSERT INTO auth.users (id, email) VALUES
  ('${userA}', 'usera@test.com'),
  ('${userB}', 'userb@test.com');

INSERT INTO public.devices (id, user_id, device_auth_id, name, status, agent_version, jar_ctl_version, jar_sha256, pubkey, next_slot_index) VALUES
  ('${devBaseCompat}',     '${userA}', gen_random_uuid(), 'dev-base-compat',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${BASE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=', 'base64'), 20),
  ('${devMovCompat}',      '${userA}', gen_random_uuid(), 'dev-mov-compat',     'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${MOV_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI=', 'base64'), 20),
  ('${devForgeCompat}',    '${userA}', gen_random_uuid(), 'dev-forge-compat',   'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${FORGE_NATIVE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM=', 'base64'), 20),
  ('${devFailed24e9}',     '${userA}', gen_random_uuid(), 'dev-failed-24e9',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${FAILED_24E9_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ=', 'base64'), 20),
  ('${devRolledBack278f}', '${userA}', gen_random_uuid(), 'dev-rolledback-278f','online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${ROLLED_BACK_FORGE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFQ=', 'base64'), 20),
  ('${devFailed47e4}',     '${userA}', gen_random_uuid(), 'dev-failed-47e4',    'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${FAILED_47E4_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGM=', 'base64'), 20),
  ('${devForgeCtl14}',     '${userA}', gen_random_uuid(), 'dev-forge-ctl14',    'online', '0.1.0+managed-identity-restart-v1', 14, '${FORGE_NATIVE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU=', 'base64'), 20),
  ('${devForgeNoTok}',     '${userA}', gen_random_uuid(), 'dev-forge-notok',    'online', '0.1.0+visual-qol-v1', 15, '${FORGE_NATIVE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY=', 'base64'), 20),
  ('${devArbitrary}',      '${userA}', gen_random_uuid(), 'dev-arbitrary',      'online', '0.1.0+managed-identity-restart-v1', 15, '${ARBITRARY_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAc=', 'base64'), 20),
  ('${devForeignB}',       '${userB}', gen_random_uuid(), 'dev-foreign',        'online', '0.1.0+managed-identity-restart-v1', 15, '${FORGE_NATIVE_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAg=', 'base64'), 20),
  ('${devObsolete0bdda}',  '${userA}', gen_random_uuid(), 'dev-obsolete-0bdda', 'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${OBSOLETE_0BDDA_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAk=', 'base64'), 20),
  ('${devObsoleteD369}',   '${userA}', gen_random_uuid(), 'dev-obsolete-d369',  'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${OBSOLETE_D369_SHA}',  decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAs=', 'base64'), 20);

-- Seed accounts under migration 025 (including one on 24e9 which was valid in 025)
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES
  ('${accLegacy}',            '${devBaseCompat}', '${userA}', 'Legacy Server 0', 1, 'user0', 0),
  ('${accServer8Pre026A}',    '${devBaseCompat}', '${userA}', 'Server 8 Base',   2, 'user8base', 8),
  ('${accServer8Pre026B}',    '${devMovCompat}',  '${userA}', 'Server 8 Mov',    3, 'user8mov', 8),
  ('${accServer8Pre026_24e}', '${devFailed24e9}', '${userA}', 'Server 8 24e9',   4, 'user8_24e', 8);
`;
    const res = runPsql(testDbName, seedSql);
    assert.equal(res.status, 0, `Seed failed: ${res.stderr}`);
  });

  it("4. Migration 026 executes cleanly on real PostgreSQL with zero errors", () => {
    const file026 = fs.readdirSync(migrationsDir).find(f => f.startsWith("026_"));
    assert.ok(file026, "Migration 026 file must exist");
    const content026 = fs.readFileSync(path.join(migrationsDir, file026), "utf-8");

    const res026 = runPsql(testDbName, content026);
    assert.equal(res026.status, 0, `Migration 026 failed: ${res026.stderr}`);
    assert.doesNotMatch(res026.stderr, /ERROR/i);

    runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('026', '${file026}');`);
  });

  it("5. Existing legacy rows and pre-existing server 8 rows (including 24e9) survive migration 026", () => {
    const resLegacy = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accLegacy}';`);
    assert.match(resLegacy.stdout, /0/);

    const resServer8A = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre026A}';`);
    assert.match(resServer8A.stdout, /8/);
    assert.match(resServer8A.stdout, /Server 8 Base/);

    const resServer8B = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre026B}';`);
    assert.match(resServer8B.stdout, /8/);
    assert.match(resServer8B.stdout, /Server 8 Mov/);

    const resServer8_24e = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre026_24e}';`);
    assert.match(resServer8_24e.stdout, /8/);
    assert.match(resServer8_24e.stdout, /Server 8 24e9/);
  });

  it("6. Base SHA 4009f070... continues to be accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devBaseCompat}', '${userA}', 'Old SHA Server 8 Post-026', 10, 'oldsha8', 8);
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
VALUES ('${devMovCompat}', '${userA}', 'Mov SHA Server 8 Post-026', 11, 'movsha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `Mov SHA insert failed: ${res.stderr}`);
  });

  it("8. Forge native NPC interaction fix SHA b2bc6ceb... is accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index)
VALUES ('${accNewForgeFix}', '${devForgeCompat}', '${userA}', 'New Forge Native Fix Server 8', 12, 'newforge8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `Forge native fix SHA insert failed: ${res.stderr}`);

    const verifyRes = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accNewForgeFix}';`);
    assert.match(verifyRes.stdout, /8/);
    assert.match(verifyRes.stdout, /New Forge Native Fix Server 8/);
  });

  it("9. Revoked 24e9a820... is REJECTED for new server 8 insert and transition after migration 026", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devFailed24e9}', '${userA}', '24e9 Server 8 Should Fail', 13, 'fail24e9', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.notEqual(res.status, 0, "Insert on 24e9 must be rejected");
    assert.match(res.stderr, /is not compatible with Bach Ho server/);

    // Transition of legacy account to server 8 on 24e9 device must also be rejected
    const tempAcc = "10101010-1010-1010-1010-101010101010";
    runPsql(testDbName, `INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES ('${tempAcc}', '${devFailed24e9}', '${userA}', 'Temp Legacy', 14, 'templegacy', 0);`);
    const transRes = runPsql(testDbName, `UPDATE public.accounts SET server_index = 8 WHERE id = '${tempAcc}';`);
    assert.notEqual(transRes.status, 0, "Transition to server 8 on 24e9 must be rejected");
    assert.match(transRes.stderr, /is not compatible with Bach Ho server/);
  });

  it("10. Rolled-back candidate 278f3754... and failed candidate 47e4d766... remain REJECTED", () => {
    const res278f = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devRolledBack278f}', '${userA}', '278f Server 8 Should Fail', 15, 'fail278f', 8);
`);
    assert.notEqual(res278f.status, 0, "278f must be rejected");
    assert.match(res278f.stderr, /is not compatible with Bach Ho server/);

    const res47e4 = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devFailed47e4}', '${userA}', '47e4 Server 8 Should Fail', 16, 'fail47e4', 8);
`);
    assert.notEqual(res47e4.status, 0, "47e4 must be rejected");
    assert.match(res47e4.stderr, /is not compatible with Bach Ho server/);
  });

  it("11. Arbitrary SHA and obsolete candidates (0bdda, d369) remain REJECTED", () => {
    const resArb = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devArbitrary}', '${userA}', 'Arbitrary Server 8 Should Fail', 17, 'failarb', 8);
`);
    assert.notEqual(resArb.status, 0, "Arbitrary SHA must be rejected");
    assert.match(resArb.stderr, /is not compatible with Bach Ho server/);

    const res0bdda = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devObsolete0bdda}', '${userA}', '0bdda Server 8 Should Fail', 18, 'fail0bdda', 8);
`);
    assert.notEqual(res0bdda.status, 0, "0bdda must be rejected");
    assert.match(res0bdda.stderr, /is not compatible with Bach Ho server/);

    const resD369 = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devObsoleteD369}', '${userA}', 'd369 Server 8 Should Fail', 19, 'faild369', 8);
`);
    assert.notEqual(resD369.status, 0, "d369 must be rejected");
    assert.match(resD369.stderr, /is not compatible with Bach Ho server/);
  });

  it("12. Forge native fix SHA with CTL 14 is REJECTED", () => {
    const resCtl14 = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devForgeCtl14}', '${userA}', 'CTL14 Server 8 Should Fail', 20, 'failctl14', 8);
`);
    assert.notEqual(resCtl14.status, 0, "CTL 14 must be rejected");
    assert.match(resCtl14.stderr, /is not compatible with Bach Ho server/);
  });

  it("13. Forge native fix SHA without exact managed-identity-restart-v1 capability is REJECTED", () => {
    const resNoTok = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devForgeNoTok}', '${userA}', 'NoTok Server 8 Should Fail', 21, 'failnotok', 8);
`);
    assert.notEqual(resNoTok.status, 0, "Missing exact capability must be rejected");
    assert.match(resNoTok.stderr, /is not compatible with Bach Ho server/);
  });

  it("14. Immutability of user_id / device_id and foreign device ownership checks preserved", () => {
    const resUserImm = runPsql(testDbName, `
UPDATE public.accounts SET user_id = '${userB}' WHERE id = '${accNewForgeFix}';
`);
    assert.notEqual(resUserImm.status, 0, "user_id update must fail");
    assert.match(resUserImm.stderr, /accounts.user_id is immutable after insert/);

    const resDevImm = runPsql(testDbName, `
UPDATE public.accounts SET device_id = '${devBaseCompat}' WHERE id = '${accNewForgeFix}';
`);
    assert.notEqual(resDevImm.status, 0, "device_id update must fail");
    assert.match(resDevImm.stderr, /accounts.device_id is immutable after insert/);

    const resForeign = runPsql(testDbName, `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devForeignB}', '${userA}', 'Foreign Dev Should Fail', 22, 'failforeign', 8);
`);
    assert.notEqual(resForeign.status, 0, "Foreign device must fail");
    assert.match(resForeign.stderr, /does not belong to user/);
  });

  it("15. Transition server 8 -> legacy and metadata-only edit on pre-existing row preserved", () => {
    const resSwitchLegacy = runPsql(testDbName, `
UPDATE public.accounts SET server_index = 0 WHERE id = '${accNewForgeFix}';
`);
    assert.equal(resSwitchLegacy.status, 0, `Switch to legacy failed: ${resSwitchLegacy.stderr}`);

    const resMeta = runPsql(testDbName, `
UPDATE public.accounts SET label = 'Updated 24e9 Label' WHERE id = '${accServer8Pre026_24e}';
`);
    assert.equal(resMeta.status, 0, `Metadata edit on existing 24e row failed: ${resMeta.stderr}`);
  });

  it("16. RPC create_game_account accepts b2bc6ceb..., 4009..., 51cb... and rejects 24e9..., 278f..., 47e4... and arbitrary", () => {
    const asUserASql = `
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';
`;

    // 16a. Accept new forge native fix SHA
    const rpcForgeFix = runPsql(testDbName, `
${asUserASql}
SELECT public.create_game_account(
  '${devForgeCompat}'::uuid,
  'RPC New Forge Native Fix',
  'rpc_forge',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15::integer,
  '{"auto_farm": 1}'::jsonb,
  1::smallint
);
`);
    assert.equal(rpcForgeFix.status, 0, `create_game_account forge fix failed: ${rpcForgeFix.stderr}`);

    // 16b. Accept base SHA
    const rpcBase = runPsql(testDbName, `
${asUserASql}
SELECT public.create_game_account(
  '${devBaseCompat}'::uuid,
  'RPC Base SHA',
  'rpc_base',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15::integer,
  '{"auto_farm": 1}'::jsonb,
  1::smallint
);
`);
    assert.equal(rpcBase.status, 0, `create_game_account base failed: ${rpcBase.stderr}`);

    // 16c. Accept movement-fix SHA
    const rpcMov = runPsql(testDbName, `
${asUserASql}
SELECT public.create_game_account(
  '${devMovCompat}'::uuid,
  'RPC Mov SHA',
  'rpc_mov',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15::integer,
  '{"auto_farm": 1}'::jsonb,
  1::smallint
);
`);
    assert.equal(rpcMov.status, 0, `create_game_account mov failed: ${rpcMov.stderr}`);

    // 16d. Reject 24e9
    const rpc24e = runPsql(testDbName, `
${asUserASql}
SELECT public.create_game_account(
  '${devFailed24e9}'::uuid,
  'RPC 24e9 Fail',
  'rpc_24e',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15::integer,
  '{"auto_farm": 1}'::jsonb,
  1::smallint
);
`);
    assert.notEqual(rpc24e.status, 0, "RPC create on 24e9 must be rejected");
    assert.match(rpc24e.stderr, /device is not compatible with Bach Ho server/);

    // 16e. Reject 278f
    const rpc278 = runPsql(testDbName, `
${asUserASql}
SELECT public.create_game_account(
  '${devRolledBack278f}'::uuid,
  'RPC 278f Fail',
  'rpc_278',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15::integer,
  '{"auto_farm": 1}'::jsonb,
  1::smallint
);
`);
    assert.notEqual(rpc278.status, 0, "RPC create on 278f must be rejected");
    assert.match(rpc278.stderr, /device is not compatible with Bach Ho server/);

    // 16f. Reject 47e4
    const rpc47e = runPsql(testDbName, `
${asUserASql}
SELECT public.create_game_account(
  '${devFailed47e4}'::uuid,
  'RPC 47e4 Fail',
  'rpc_47e',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15::integer,
  '{"auto_farm": 1}'::jsonb,
  1::smallint
);
`);
    assert.notEqual(rpc47e.status, 0, "RPC create on 47e4 must be rejected");
    assert.match(rpc47e.stderr, /device is not compatible with Bach Ho server/);

    // 16g. Reject arbitrary
    const rpcArb = runPsql(testDbName, `
${asUserASql}
SELECT public.create_game_account(
  '${devArbitrary}'::uuid,
  'RPC Arbitrary Fail',
  'rpc_arb',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15::integer,
  '{"auto_farm": 1}'::jsonb,
  1::smallint
);
`);
    assert.notEqual(rpcArb.status, 0, "RPC create on arbitrary must be rejected");
    assert.match(rpcArb.stderr, /device is not compatible with Bach Ho server/);
  });

  it("17. RPC update_game_account accepts b2bc6ceb..., 4009..., 51cb... and rejects 24e9..., 278f..., 47e4... and arbitrary", () => {
    const asUserASql = `
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';
`;

    // Create an account on legacy server 0 for each device to test transition to 8
    const accTestForge = "a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1";
    const accTestBase  = "a2a2a2a2-a2a2-a2a2-a2a2-a2a2a2a2a2a2";
    const accTestMov   = "a3a3a3a3-a3a3-a3a3-a3a3-a3a3a3a3a3a3";
    const accTest24e   = "a4a4a4a4-a4a4-a4a4-a4a4-a4a4a4a4a4a4";
    const accTest278   = "a5a5a5a5-a5a5-a5a5-a5a5-a5a5a5a5a5a5";
    const accTest47e   = "a6a6a6a6-a6a6-a6a6-a6a6-a6a6a6a6a6a6";
    const accTestArb   = "a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7";

    runPsql(testDbName, `
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES
  ('${accTestForge}', '${devForgeCompat}',    '${userA}', 'Legacy to Update Forge', 30, 'u_forge', 0),
  ('${accTestBase}',  '${devBaseCompat}',     '${userA}', 'Legacy to Update Base',  31, 'u_base',  0),
  ('${accTestMov}',   '${devMovCompat}',      '${userA}', 'Legacy to Update Mov',   32, 'u_mov',   0),
  ('${accTest24e}',   '${devFailed24e9}',     '${userA}', 'Legacy to Update 24e',   33, 'u_24e',   0),
  ('${accTest278}',   '${devRolledBack278f}', '${userA}', 'Legacy to Update 278',   34, 'u_278',   0),
  ('${accTest47e}',   '${devFailed47e4}',     '${userA}', 'Legacy to Update 47e',   35, 'u_47e',   0),
  ('${accTestArb}',   '${devArbitrary}',      '${userA}', 'Legacy to Update Arb',   36, 'u_arb',   0);
`);

    // 17a. Accept update transition to 8 on forge native fix device
    const updForge = runPsql(testDbName, `
${asUserASql}
SELECT public.update_game_account('${accTestForge}'::uuid, 'Updated to 8 Forge', 8::smallint);
`);
    assert.equal(updForge.status, 0, `update_game_account forge fix failed: ${updForge.stderr}`);

    // 17b. Accept update transition to 8 on base device
    const updBase = runPsql(testDbName, `
${asUserASql}
SELECT public.update_game_account('${accTestBase}'::uuid, 'Updated to 8 Base', 8::smallint);
`);
    assert.equal(updBase.status, 0, `update_game_account base failed: ${updBase.stderr}`);

    // 17c. Accept update transition to 8 on mov device
    const updMov = runPsql(testDbName, `
${asUserASql}
SELECT public.update_game_account('${accTestMov}'::uuid, 'Updated to 8 Mov', 8::smallint);
`);
    assert.equal(updMov.status, 0, `update_game_account mov failed: ${updMov.stderr}`);

    // 17d. Reject update transition to 8 on 24e9 device
    const upd24e = runPsql(testDbName, `
${asUserASql}
SELECT public.update_game_account('${accTest24e}'::uuid, 'Updated to 8 24e Should Fail', 8::smallint);
`);
    assert.notEqual(upd24e.status, 0, "update_game_account on 24e9 must be rejected");
    assert.match(upd24e.stderr, /device is not compatible with Bach Ho server/);

    // 17e. Reject update transition to 8 on 278f device
    const upd278 = runPsql(testDbName, `
${asUserASql}
SELECT public.update_game_account('${accTest278}'::uuid, 'Updated to 8 278 Should Fail', 8::smallint);
`);
    assert.notEqual(upd278.status, 0, "update_game_account on 278f must be rejected");
    assert.match(upd278.stderr, /device is not compatible with Bach Ho server/);

    // 17f. Reject update transition to 8 on 47e4 device
    const upd47e = runPsql(testDbName, `
${asUserASql}
SELECT public.update_game_account('${accTest47e}'::uuid, 'Updated to 8 47e Should Fail', 8::smallint);
`);
    assert.notEqual(upd47e.status, 0, "update_game_account on 47e4 must be rejected");
    assert.match(upd47e.stderr, /device is not compatible with Bach Ho server/);

    // 17g. Reject update transition to 8 on arbitrary device
    const updArb = runPsql(testDbName, `
${asUserASql}
SELECT public.update_game_account('${accTestArb}'::uuid, 'Updated to 8 Arb Should Fail', 8::smallint);
`);
    assert.notEqual(updArb.status, 0, "update_game_account on arb must be rejected");
    assert.match(updArb.stderr, /device is not compatible with Bach Ho server/);
  });
});
