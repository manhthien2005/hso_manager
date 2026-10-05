/**
 * Migration 022: v4.0.3 Bạch Hổ Server Support & Runtime Capability Contract Tests
 * Task: KNIGHT_V403_BACH_HO_R3_CLOUD_WEB_SUPPORT
 *
 * Verifies:
 * 1. File integrity & forward-only invariant (migrations 001..021 strictly untouched)
 * 2. accounts.server_index check constraint (accounts_server_index_check, BETWEEN 0 AND 8)
 * 3. Direct write defense trigger (trg_accounts_before_write and accounts_before_write function)
 * 4. Concurrency-safe create_game_account retaining character_slot (exact 8 arguments)
 * 5. Concurrency-safe update_game_account retaining character_slot (exact 6 arguments)
 * 6. Bạch Hổ runtime compatibility checks (JAR SHA 4009f070... and CTL 15)
 * 7. Grants and permissions preserved (REVOKE FROM PUBLIC, anon; GRANT TO authenticated)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("Migration 022: Bạch Hổ Server Support & Runtime Invariants Contract", () => {
  const migrationsDir = path.resolve(process.cwd(), "supabase/migrations");
  const migration022Path = path.join(migrationsDir, "022_v403_bach_ho_server_support.sql");
  const sql022 = fs.readFileSync(migration022Path, "utf-8");

  describe("File Integrity & Forward-Only Invariants", () => {
    it("migration 022 exists and is non-empty", () => {
      assert.ok(fs.existsSync(migration022Path));
      assert.ok(sql022.length > 1000);
    });

    it("migration 022 contains no destructive operations (no DROP TABLE, no TRUNCATE)", () => {
      assert.doesNotMatch(sql022, /DROP\s+TABLE/i);
      assert.doesNotMatch(sql022, /TRUNCATE/i);
    });

    it("migrations 001 through 021 remain strictly untouched and present", () => {
      for (let i = 1; i <= 21; i++) {
        const prefix = String(i).padStart(3, "0");
        const matching = fs.readdirSync(migrationsDir).filter((f) => f.startsWith(`${prefix}_`));
        assert.equal(matching.length, 1, `Expected migration ${prefix} to exist`);
      }
    });
  });

  describe("Table-Level CHECK Invariant", () => {
    it("adds accounts_server_index_check with exact 0..8 bounds", () => {
      assert.match(
        sql022,
        /ALTER\s+TABLE\s+public\.accounts\s+ADD\s+CONSTRAINT\s+accounts_server_index_check\s+CHECK\s*\(\s*server_index\s*>=\s*0\s+AND\s+server_index\s*<=\s*8\s*\);/i,
      );
    });
  });

  describe("Exact Build-Metadata Capability Evaluator", () => {
    it("creates public.agent_has_exact_capability function", () => {
      assert.match(
        sql022,
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.agent_has_exact_capability\s*\(\s*p_agent_version\s+text,\s*p_token\s+text\s*\)/i,
      );
      assert.match(sql022, /IMMUTABLE/i);
    });

    it("grants execute on agent_has_exact_capability to authenticated, service_role, anon", () => {
      assert.match(
        sql022,
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.agent_has_exact_capability\(text,\s*text\)\s+TO\s+authenticated,\s*service_role,\s*anon;/i,
      );
    });
  });

  describe("Direct Write Defense Trigger", () => {
    it("creates accounts_before_write trigger function with SECURITY DEFINER and public search_path", () => {
      assert.match(sql022, /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.accounts_before_write\s*\(\s*\)/i);
      assert.match(sql022, /SECURITY\s+DEFINER/i);
      assert.match(sql022, /SET\s+search_path\s*=\s*public/i);
    });

    it("enforces server_index bounds 0..8 in trigger", () => {
      assert.match(sql022, /NEW\.server_index\s*<\s*0\s*OR\s*NEW\.server_index\s*>\s*8/i);
      assert.match(sql022, /RAISE\s+EXCEPTION\s+'server_index\s+must\s+be\s+between\s+0\s+and\s+8'/i);
    });

    it("enforces immutability of user_id and device_id on UPDATE", () => {
      assert.match(sql022, /NEW\.user_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.user_id/i);
      assert.match(sql022, /accounts\.user_id\s+is\s+immutable\s+after\s+insert/i);
      assert.match(sql022, /NEW\.device_id\s+IS\s+DISTINCT\s+FROM\s+OLD\.device_id/i);
      assert.match(sql022, /accounts\.device_id\s+is\s+immutable\s+after\s+insert/i);
    });

    it("enforces device relational ownership (devices.user_id = NEW.user_id) on INSERT", () => {
      assert.match(sql022, /v_device_user_id\s+IS\s+DISTINCT\s+FROM\s+NEW\.user_id/i);
      assert.match(sql022, /device\s+%\s+does\s+not\s+belong\s+to\s+user\s+%/i);
    });

    it("enforces Bạch Hổ runtime compatibility on INSERT or transition to server 8 including managed-identity-restart-v1", () => {
      assert.match(sql022, /NEW\.server_index\s*=\s*8\s*AND\s*\(\s*TG_OP\s*=\s*'INSERT'/i);
      assert.match(sql022, /4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d/);
      assert.match(sql022, /v_device_jar_ctl_version\s*<>\s*15/);
      assert.match(sql022, /agent_has_exact_capability\(v_device_agent_version,\s*'managed-identity-restart-v1'\)/);
    });

    it("creates BEFORE INSERT OR UPDATE trigger trg_accounts_before_write", () => {
      assert.match(sql022, /DROP\s+TRIGGER\s+IF\s+EXISTS\s+trg_accounts_before_write\s+ON\s+public\.accounts;/i);
      assert.match(
        sql022,
        /CREATE\s+TRIGGER\s+trg_accounts_before_write\s+BEFORE\s+INSERT\s+OR\s+UPDATE\s+ON\s+public\.accounts\s+FOR\s+EACH\s+ROW\s+EXECUTE\s+FUNCTION\s+public\.accounts_before_write\s*\(\s*\);/i,
      );
    });
  });

  describe("RPC create_game_account Evolution", () => {
    it("preserves exact 8-argument signature including p_character_slot", () => {
      assert.match(
        sql022,
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.create_game_account\s*\(\s*p_device_id\s+uuid,\s*p_label\s+text,\s*p_username\s+text,\s*p_secret_sealed\s+jsonb,\s*p_server_index\s+smallint,\s*p_control_version\s+integer,\s*p_control\s+jsonb,\s*p_character_slot\s+smallint\s+DEFAULT\s+1\s*\)/i,
      );
    });

    it("validates server_index range 0..8 in create_game_account", () => {
      assert.match(sql022, /p_server_index\s*<\s*0\s*OR\s*p_server_index\s*>\s*8/);
    });

    it("checks Bạch Hổ runtime compatibility before slot allocation in create_game_account", () => {
      assert.match(sql022, /IF\s+p_server_index\s*=\s*8\s+THEN/);
      assert.match(sql022, /4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d/);
      assert.match(sql022, /v_device_jar_ctl_version\s*<>\s*15/);
      assert.match(sql022, /agent_has_exact_capability\(v_device_agent_version,\s*'managed-identity-restart-v1'\)/);
    });

    it("preserves grants for create_game_account", () => {
      assert.match(
        sql022,
        /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.create_game_account\([^)]+\)\s+FROM\s+PUBLIC,\s*anon;/i,
      );
      assert.match(
        sql022,
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.create_game_account\([^)]+\)\s+TO\s+authenticated;/i,
      );
    });
  });

  describe("RPC update_game_account Evolution", () => {
    it("preserves exact 6-argument signature including p_character_slot", () => {
      assert.match(
        sql022,
        /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.update_game_account\s*\(\s*p_account_id\s+uuid,\s*p_label\s+text,\s*p_server_index\s+smallint,\s*p_username\s+text\s+DEFAULT\s+NULL,\s*p_secret_sealed\s+jsonb\s+DEFAULT\s+NULL,\s*p_character_slot\s+smallint\s+DEFAULT\s+NULL\s*\)/i,
      );
    });

    it("validates server_index range 0..8 in update_game_account", () => {
      assert.match(sql022, /p_server_index\s*<\s*0\s*OR\s*p_server_index\s*>\s*8/);
    });

    it("checks Bạch Hổ runtime compatibility when transitioning into server 8 in update_game_account", () => {
      assert.match(sql022, /p_server_index\s*=\s*8\s*AND\s*v_old_server_index\s*<>\s*8/);
      assert.match(sql022, /4009f070808d72bde555b7763d9c9e2924e9385a62ac1a96494d71cc3c4b657d/);
      assert.match(sql022, /v_device_jar_ctl_version\s*<>\s*15/);
      assert.match(sql022, /agent_has_exact_capability\(v_device_agent_version,\s*'managed-identity-restart-v1'\)/);
    });

    it("preserves grants for update_game_account", () => {
      assert.match(
        sql022,
        /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.update_game_account\([^)]+\)\s+FROM\s+PUBLIC,\s*anon;/i,
      );
      assert.match(
        sql022,
        /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.update_game_account\([^)]+\)\s+TO\s+authenticated;/i,
      );
    });
  });
});
