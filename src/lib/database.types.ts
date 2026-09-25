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
          character_slot: number;
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
          character_slot?: number;
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
      farm_spots: {
        Row: {
          id: string;
          user_id: string;
          name: string;
          map_id: number;
          x: number;
          y: number;
          captured_zone: number;
          source: string; // "manual" | "detected" | "imported"
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["farm_spots"]["Row"], "id" | "captured_zone" | "source" | "created_at" | "updated_at"> & {
          id?: string;
          captured_zone?: number;
          source?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["farm_spots"]["Insert"]>;
        Relationships: [];
      };
      enhancement_queue_jobs: {
        Row: {
          id: string;
          account_id: string;
          device_id: string;
          user_id: string;
          status: string; // "DRAFT" | "QUEUED" | "RUNNING" | "PAUSING" | "PAUSED" | "COMPLETED" | "FAILED" | "CANCELLED" | "MANUAL_REVIEW_REQUIRED"
          active_item_id: string | null;
          active_attempt_uuid: string | null;
          active_command_id: string | null;
          total_items: number;
          completed_items: number;
          claimed_by: string | null;
          claimed_at: string | null;
          claim_expires_at: string | null;
          pause_requested_at: string | null;
          cancel_requested_at: string | null;
          error_code: string | null;
          error_message: string | null;
          created_at: string;
          started_at: string | null;
          finished_at: string | null;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["enhancement_queue_jobs"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["enhancement_queue_jobs"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "enhancement_queue_jobs_account_id_fkey";
            columns: ["account_id"];
            isOneToOne: false;
            referencedRelation: "accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "enhancement_queue_jobs_device_id_fkey";
            columns: ["device_id"];
            isOneToOne: false;
            referencedRelation: "devices";
            referencedColumns: ["id"];
          },
        ];
      };
      enhancement_queue_items: {
        Row: {
          id: string;
          job_id: string;
          account_id: string;
          user_id: string;
          queue_order: number;
          captured_slot: number;
          template_id: number;
          category: number;
          base_name: string;
          tier: number;
          icon: number | null;
          initial_level: number;
          current_level: number;
          target_level: number;
          payment_type: string; // "GOLD" | "GEMS"
          charm_mode: string; // "NONE" | "CO_3_LA" | "CO_4_LA" | "AUTO_POLICY" | "THREE_LEAF" | "FOUR_LEAF"
          status: string; // "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "CANCELLED" | "MANUAL_REVIEW_REQUIRED"
          attempt_count: number;
          active_attempt_uuid: string | null;
          attempt_phase: string; // "NONE" | "PREPARING" | "READY_TO_EXECUTE" | "EXECUTE_MAY_HAVE_BEEN_SENT" | "WAITING_RESULT" | "WAITING_SETTLEMENT" | "SETTLED"
          attempt_expected_level: number | null;
          attempt_target_level: number | null;
          attempt_started_at: string | null;
          execute_may_have_been_sent_at: string | null;
          attempt_settled_at: string | null;
          last_result_code: string | null;
          actual_gold_spent: number;
          actual_gem_spent: number;
          actual_material_1_spent: number;
          actual_material_2_spent: number;
          actual_material_3_spent: number;
          actual_material_4_spent: number;
          actual_charm_spent: number;
          error_code: string | null;
          error_message: string | null;
          started_at: string | null;
          finished_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["enhancement_queue_items"]["Row"], "id" | "created_at" | "updated_at"> & {
          id?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["enhancement_queue_items"]["Insert"]>;
        Relationships: [
          {
            foreignKeyName: "enhancement_queue_items_job_id_fkey";
            columns: ["job_id"];
            isOneToOne: false;
            referencedRelation: "enhancement_queue_jobs";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      enhancement_queue_job_summaries: {
        Row: Database["public"]["Tables"]["enhancement_queue_jobs"]["Row"] & {
          actual_gold_spent: number;
          actual_gem_spent: number;
          actual_material_1_spent: number;
          actual_material_2_spent: number;
          actual_material_3_spent: number;
          actual_material_4_spent: number;
          actual_charm_spent: number;
          total_attempt_count: number;
        };
        Relationships: [];
      };
    };
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
          p_character_slot?: number;
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
          p_character_slot?: number | null;
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
      publish_enhancement_queue_job: {
        Args: {
          p_job_id: string;
        };
        Returns: Database["public"]["Tables"]["enhancement_queue_jobs"]["Row"];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}

