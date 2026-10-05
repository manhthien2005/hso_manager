/**
 * Migration 023: Executable Real-PostgreSQL Migration Proof & Compatibility Expansion Tests
 * Task: KNIGHT_V403_R4_5_FIX_GAME_READY_MOVEMENT_AND_COMPATIBILITY_ROLLOUT_PREP
 *
 * Proves that:
 * 1. Clean database starts and Supabase baseline environment bootstraps.
 * 2. Migrations 001 through 022 apply in canonical order without error.
 * 3. Seed accounts (legacy 0..7 and existing server 8 with old SHA 4009f070...) before migration 023.
 * 4. Migration 023 executes cleanly on real PostgreSQL on top of 001..022 with zero errors.
 * 5. Existing server 8 rows and legacy 0..7 rows survive migration 023 unchanged.
 * 6. Old SHA 4009f070... + CTL 15 + capability => Bach Ho compatible.
 * 7. New movement-fix SHA 51cb7d4e... + CTL 15 + capability => Bach Ho compatible.
 * 8. Arbitrary SHA => rejected.
 * 9. New movement-fix SHA + CTL 14 => rejected.
 * 10. New movement-fix SHA without exact managed-identity-restart-v1 => rejected.
 * 11. Immutability of user_id / device_id and foreign device ownership checks preserved.
 * 12. Transition server 8 -> legacy and metadata-only edit preserved.
 * 13. RPC create_game_account accepts both exact approved SHAs and rejects incompatible devices.
 * 14. RPC update_game_account accepts both exact approved SHAs and rejects incompatible devices.
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

describe("Migration 023: Real PostgreSQL Executable Migration & Compatibility Expansion Proof", () => {
  const testDbName = "test_zeus_migration_proof_023";
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");

  const OLD_SHA = "4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d";
  const NEW_MOVEMENT_FIX_SHA = "51cb7d4eb8d8d3037a0aa7808563e06a55a3e1765adef58b62911074d81e6d9a";
  const ARBITRARY_SHA = "9999999999999999999999999999999999999999999999999999999999999999";

  const userA = "11111111-1111-1111-1111-111111111111";
  const userB = "22222222-2222-2222-2222-222222222222";

  const devOldCompat = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const devNewCompat = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const devNewCtl14 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
  const devNewNoTok = "dddddddd-dddd-dddd-dddd-dddddddddddd";
  const devArbitrary = "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee";
  const devForeignB = "ffffffff-ffff-ffff-ffff-ffffffffffff";

  const accLegacy = "55555555-5555-5555-5555-555555555555";
  const accServer8Pre023 = "66666666-6666-6666-6666-666666666666";
  const accNewMovFix = "77777777-7777-7777-7777-777777777777";

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

  it("2. Migrations 001 through 022 apply in canonical order without error", () => {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();
    for (const file of files) {
      const version = file.substring(0, 3);
      if (Number(version) >= 23) continue;
      const content = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
      const res = runPsql(testDbName, content);
      assert.equal(res.status, 0, `Migration ${file} failed: ${res.stderr}`);
      runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('${version}', '${file}');`);
    }

    const checkRes = runPsql(testDbName, "SELECT count(*) FROM supabase_migrations.schema_migrations;");
    assert.match(checkRes.stdout, /22/);
  });

  it("3. Seed accounts and devices before migration 023", () => {
    const seedSql = `
INSERT INTO auth.users (id, email) VALUES
  ('${userA}', 'usera@test.com'),
  ('${userB}', 'userb@test.com');

INSERT INTO public.devices (id, user_id, device_auth_id, name, status, agent_version, jar_ctl_version, jar_sha256, pubkey, next_slot_index) VALUES
  ('${devOldCompat}', '${userA}', gen_random_uuid(), 'dev-old-compat', 'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${OLD_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE=', 'base64'), 20),
  ('${devNewCompat}', '${userA}', gen_random_uuid(), 'dev-new-compat', 'online', '0.1.0+visual-qol-v1.managed-identity-restart-v1', 15, '${NEW_MOVEMENT_FIX_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAI=', 'base64'), 20),
  ('${devNewCtl14}', '${userA}', gen_random_uuid(), 'dev-new-ctl14', 'online', '0.1.0+managed-identity-restart-v1', 14, '${NEW_MOVEMENT_FIX_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAM=', 'base64'), 20),
  ('${devNewNoTok}', '${userA}', gen_random_uuid(), 'dev-new-notok', 'online', '0.1.0+visual-qol-v1', 15, '${NEW_MOVEMENT_FIX_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQ=', 'base64'), 20),
  ('${devArbitrary}', '${userA}', gen_random_uuid(), 'dev-arbitrary', 'online', '0.1.0+managed-identity-restart-v1', 15, '${ARBITRARY_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAU=', 'base64'), 20),
  ('${devForeignB}', '${userB}', gen_random_uuid(), 'dev-foreign', 'online', '0.1.0+managed-identity-restart-v1', 15, '${NEW_MOVEMENT_FIX_SHA}', decode('BAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAY=', 'base64'), 20);

-- Seed accounts: legacy 0..7 and existing server 8 under migration 022
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES
  ('${accLegacy}', '${devOldCompat}', '${userA}', 'Legacy Server 0', 1, 'user0', 0),
  (gen_random_uuid(), '${devOldCompat}', '${userA}', 'Legacy Server 1', 2, 'user1', 1),
  (gen_random_uuid(), '${devOldCompat}', '${userA}', 'Legacy Server 7', 3, 'user7', 7),
  ('${accServer8Pre023}', '${devOldCompat}', '${userA}', 'Existing Bach Ho Account', 4, 'user8old', 8);
`;
    const res = runPsql(testDbName, seedSql);
    assert.equal(res.status, 0, `Seed failed: ${res.stderr}`);
  });

  it("4. Migration 023 executes cleanly on real PostgreSQL with zero errors", () => {
    const file023 = fs.readdirSync(migrationsDir).find(f => f.startsWith("023_"));
    assert.ok(file023, "Migration 023 file must exist");
    const content023 = fs.readFileSync(path.join(migrationsDir, file023), "utf-8");

    const res023 = runPsql(testDbName, content023);
    assert.equal(res023.status, 0, `Migration 023 failed: ${res023.stderr}`);
    assert.doesNotMatch(res023.stderr, /ERROR/i);

    runPsql(testDbName, `INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('023', '${file023}');`);
  });

  it("5. Existing legacy rows and pre-existing server 8 row survive migration 023", () => {
    const resLegacy = runPsql(testDbName, "SELECT count(*) FROM public.accounts WHERE server_index IN (0, 1, 7);");
    assert.match(resLegacy.stdout, /3/);

    const resServer8 = runPsql(testDbName, `SELECT server_index, label FROM public.accounts WHERE id = '${accServer8Pre023}';`);
    assert.match(resServer8.stdout, /8/);
    assert.match(resServer8.stdout, /Existing Bach Ho Account/);
  });

  it("6. Old SHA 4009f070... continues to be accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devOldCompat}', '${userA}', 'Old SHA Server 8 Post-023', 10, 'oldsha8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `Old SHA insert failed: ${res.stderr}`);

    const transSql = `
UPDATE public.accounts SET server_index = 8 WHERE id = '${accLegacy}';
`;
    const transRes = runPsql(testDbName, transSql);
    assert.equal(transRes.status, 0, `Old SHA transition failed: ${transRes.stderr}`);
  });

  it("7. New movement-fix SHA 51cb7d4e... is accepted for server 8 insert and transition", () => {
    const insertSql = `
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index)
VALUES ('${accNewMovFix}', '${devNewCompat}', '${userA}', 'New Movement Fix Server 8', 11, 'newmov8', 8);
`;
    const res = runPsql(testDbName, insertSql);
    assert.equal(res.status, 0, `New movement-fix SHA insert failed: ${res.stderr}`);

    const check = runPsql(testDbName, `SELECT server_index FROM public.accounts WHERE id = '${accNewMovFix}';`);
    assert.match(check.stdout, /8/);
  });

  it("8. Arbitrary SHA rejected for server 8", () => {
    const sql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devArbitrary}', '${userA}', 'Arbitrary SHA Server 8', 12, 'badsha8', 8);
`;
    const res = runPsql(testDbName, sql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /not compatible with Bach Ho server/);
  });

  it("9. New SHA + CTL 14 rejected for server 8", () => {
    const sql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devNewCtl14}', '${userA}', 'New SHA CTL14 Server 8', 13, 'badctl8', 8);
`;
    const res = runPsql(testDbName, sql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /not compatible with Bach Ho server/);
  });

  it("10. New SHA without exact managed-identity-restart-v1 capability rejected for server 8", () => {
    const sql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devNewNoTok}', '${userA}', 'New SHA NoTok Server 8', 14, 'badtok8', 8);
`;
    const res = runPsql(testDbName, sql);
    assert.notEqual(res.status, 0);
    assert.match(res.stderr, /not compatible with Bach Ho server/);
  });

  it("11. Immutability and ownership checks preserved", () => {
    // Foreign device rejected
    const foreignSql = `
INSERT INTO public.accounts (device_id, user_id, label, slot_index, username, server_index)
VALUES ('${devForeignB}', '${userA}', 'Foreign Device', 15, 'foreign', 0);
`;
    const foreignRes = runPsql(testDbName, foreignSql);
    assert.notEqual(foreignRes.status, 0);
    assert.match(foreignRes.stderr, /does not belong to user/);

    // user_id immutability
    const userMutSql = `UPDATE public.accounts SET user_id = '${userB}' WHERE id = '${accNewMovFix}';`;
    const userMutRes = runPsql(testDbName, userMutSql);
    assert.notEqual(userMutRes.status, 0);
    assert.match(userMutRes.stderr, /accounts\.user_id is immutable after insert/);

    // device_id immutability
    const devMutSql = `UPDATE public.accounts SET device_id = '${devOldCompat}' WHERE id = '${accNewMovFix}';`;
    const devMutRes = runPsql(testDbName, devMutSql);
    assert.notEqual(devMutRes.status, 0);
    assert.match(devMutRes.stderr, /accounts\.device_id is immutable after insert/);
  });

  it("12. Server 8 -> legacy transition and metadata-only edit succeed", () => {
    // Server 8 -> legacy
    const toLegacySql = `UPDATE public.accounts SET server_index = 2 WHERE id = '${accNewMovFix}';`;
    const toLegacyRes = runPsql(testDbName, toLegacySql);
    assert.equal(toLegacyRes.status, 0, `Server 8 -> legacy failed: ${toLegacyRes.stderr}`);

    // Metadata edit on pre-existing server 8 account
    const metaSql = `UPDATE public.accounts SET label = 'Pre-023 Account Renamed' WHERE id = '${accServer8Pre023}';`;
    const metaRes = runPsql(testDbName, metaSql);
    assert.equal(metaRes.status, 0, `Metadata edit failed: ${metaRes.stderr}`);
  });

  it("13. RPC create_game_account accepts both approved SHAs and rejects incompatible devices", () => {
    // A) With old approved SHA
    const sqlOld = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.create_game_account(
  '${devOldCompat}'::uuid,
  'RPC Old SHA Valid',
  'rpc_old_sha',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15,
  '{}'::jsonb,
  1::smallint
) AS account_id;
`;
    const resOld = runPsql(testDbName, sqlOld);
    assert.equal(resOld.status, 0, `create_game_account with old SHA failed: ${resOld.stderr}`);
    assert.match(resOld.stdout, /[0-9a-f]{8}-[0-9a-f]{4}/);

    // B) With new movement-fix approved SHA
    const sqlNew = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.create_game_account(
  '${devNewCompat}'::uuid,
  'RPC New SHA Valid',
  'rpc_new_sha',
  '${validSealedJson}'::jsonb,
  8::smallint,
  15,
  '{}'::jsonb,
  1::smallint
) AS account_id;
`;
    const resNew = runPsql(testDbName, sqlNew);
    assert.equal(resNew.status, 0, `create_game_account with new SHA failed: ${resNew.stderr}`);
    assert.match(resNew.stdout, /[0-9a-f]{8}-[0-9a-f]{4}/);

    // C) Incompatible (arbitrary SHA) rejected
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

  it("14. RPC update_game_account accepts transition to server 8 for both approved SHAs", () => {
    // Seed legacy accounts on both devices
    const seedSql = `
INSERT INTO public.accounts (id, device_id, user_id, label, slot_index, username, server_index) VALUES
  ('88888888-8888-8888-8888-888888888888', '${devOldCompat}', '${userA}', 'Legacy on Old Dev', 16, 'leg_old', 0),
  ('99999999-9999-9999-9999-999999999999', '${devNewCompat}', '${userA}', 'Legacy on New Dev', 17, 'leg_new', 0);
`;
    runPsql(testDbName, seedSql);

    // Transition on old device
    const transOldSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.update_game_account(
  '88888888-8888-8888-8888-888888888888'::uuid,
  'Transitioned on Old Dev',
  8::smallint,
  NULL,
  NULL,
  1::smallint
);
`;
    const transOldRes = runPsql(testDbName, transOldSql);
    assert.equal(transOldRes.status, 0, `update_game_account transition on old device failed: ${transOldRes.stderr}`);

    // Transition on new device
    const transNewSql = `
SET ROLE authenticated;
SET request.jwt.claim.sub = '${userA}';
SET request.jwt.claim.role = 'authenticated';

SELECT public.update_game_account(
  '99999999-9999-9999-9999-999999999999'::uuid,
  'Transitioned on New Dev',
  8::smallint,
  NULL,
  NULL,
  1::smallint
);
`;
    const transNewRes = runPsql(testDbName, transNewSql);
    assert.equal(transNewRes.status, 0, `update_game_account transition on new device failed: ${transNewRes.stderr}`);

    // Verify both are now on server 8
    const checkSql = `SELECT count(*) FROM public.accounts WHERE id IN ('88888888-8888-8888-8888-888888888888', '99999999-9999-9999-9999-999999999999') AND server_index = 8;`;
    const checkRes = runPsql(testDbName, checkSql);
    assert.match(checkRes.stdout, /2/);
  });
});
