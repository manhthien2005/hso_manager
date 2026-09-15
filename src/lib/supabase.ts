/**
 * Supabase client — singleton, khởi tạo một lần.
 *
 * Dùng anon key ở đây: mọi request đều đi qua RLS.
 * Không nhúng service_role vào frontend — một tab devtools mở là lộ key.
 *
 * SUPABASE_URL / SUPABASE_ANON_KEY phải có trong `.env.local` (Next.js).
 * Thiếu biến môi trường → throw ngay, không fail im lặng về runtime.
 */

import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Add them to .env.local — see docs/full_spec/web-manager/CLOUD-SPEC.md §2."
  );
}

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    // Lưu session trong localStorage (default). Refresh token tự động.
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
  realtime: {
    // heartbeat 25 s — dưới 30 s để server không timeout, trên 20 s để không tốn quota.
    heartbeatIntervalMs: 25_000,
  },
});
