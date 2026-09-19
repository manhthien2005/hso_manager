/**
 * Hand-maintained database types for Supabase.
 * Note: devices.pubkey BYTEA REST serialization is non-canonical.
 * Use get_device_sealing_pubkey() RPC for canonical cryptographic input.
 */

export interface Database {
  public: {
    Tables: {
      devices: {
        Row: {
          id: string;
          user_id: string | null;
          pair_code: string | null;
          name: string;
          pubkey: string | null; // bytea → base64 string khi qua REST
          agent_version: string | null;
          jar_sha256: string | null;
          jar_ctl_version: number | null;
          jar_snapshot_version: number | null;
          jar_ctl_key_count: number | null;
          status: string; // "online" | "offline" | "degraded"
          cpu_pct: number | null;
          ram_used_mb: number | null;
          ram_total_mb: number | null;
          uptime_s: number | null;
          viewer_url: string | null;
          viewer_expires_at: string | null;
          next_slot_index: number;
          last_seen: string | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["devices"]["Row"], "id" | "created_at"> & {
          id?: string;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["devices"]["Insert"]>;
        Relationships: [];
      };
      accounts: {
        Row: {
          id: string;
          device_id: string;
          user_id: string;
          label: string;
          slot_index: number;
          username: string;
          secret_sealed: Record<string, unknown>;
          server_index: number;
          desired_state: string; // "running" | "stopped"
          runtime: {
            heap_max_mib: number;
            headless: boolean;
            autostart: boolean;
          };
          control_version: number;
          control: Record<string, unknown>;
          config_version: number;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["accounts"]["Row"], "id" | "updated_at"> & {
          id?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["accounts"]["Insert"]>;
        Relationships: [];
      };
      account_runtime: {
        Row: {
          account_id: string;
          process_state: string; // "running" | "starting" | "stopped" | "crashed"
          pid: number | null;
          ram_mb: number | null;
          cpu_pct: number | null;
          snapshot_version: number | null;
          snapshot: Record<string, unknown> | null;
          config_status: string | null; // "applied" | "version_mismatch" | "error"
          config_error: string | null;
          applied_version: number | null;
          restarts: number;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["account_runtime"]["Row"], "updated_at"> & {
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["account_runtime"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "account_runtime_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: true;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      commands: {
        Row: {
          id: string;
          device_id: string;
          account_id: string | null;
          type: string; // "start" | "stop" | "restart" | "apply-config" | "open-viewer" | "close-viewer"
          payload: Record<string, unknown> | null;
          status: string; // "queued" | "running" | "success" | "failed" | "expired"
          message: string | null;
          created_at: string;
          expires_at: string;
          finished_at: string | null;
        };
        Insert: Omit<Database["public"]["Tables"]["commands"]["Row"], "id" | "created_at" | "expires_at"> & {
          id?: string;
          created_at?: string;
          expires_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["commands"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      claim_device: {
        Args: {
          code: string;
        };
        Returns: string; // uuid của device
      };
      get_device_sealing_pubkey: {
        Args: {
          p_device_id: string;
        };
        Returns: string; // canonical one-line base64 SEC1 uncompressed P-256 pubkey
      };
      create_game_account: {
        Args: {
          p_device_id: string;
          p_label: string;
          p_username: string;
          p_secret_sealed: Record<string, unknown>;
          p_server_index: number;
          p_control_version: number;
          p_control: Record<string, unknown>;
        };
        Returns: string; // uuid của account vừa tạo
      };
      update_game_account: {
        Args: {
          p_account_id: string;
          p_label: string;
          p_server_index: number;
          p_username?: string | null;
          p_secret_sealed?: Record<string, unknown> | null;
        };
        Returns: string; // uuid của account vừa cập nhật
      };
      delete_game_account: {
        Args: {
          p_account_id: string;
          p_stop_command_id: string;
        };
        Returns: string;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
