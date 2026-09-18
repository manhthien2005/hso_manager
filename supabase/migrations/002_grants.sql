-- =============================================================================
-- Zeus Knight Cloud — Grant permissions (Task 6, part 2)
-- Run trong Supabase SQL Editor:
-- https://supabase.com/dashboard/project/wuyxkksihkmsmwuiuvdk/sql/new
--
-- Vì sao cần file này riêng:
--   Supabase CREATE TABLE KHÔNG tự grant quyền cho role 'authenticated'.
--   RLS chỉ là filter — muốn filter thì trước tiên role phải có quyền vào bảng.
--   Thiếu GRANT → "permission denied for table" dù policy đúng.
-- =============================================================================

-- authenticated role: user đã đăng nhập Supabase Auth
grant select, insert, update, delete on table public.devices         to authenticated;
grant select, insert, update, delete on table public.accounts        to authenticated;
grant select, insert, update, delete on table public.account_runtime to authenticated;
grant select, insert, update, delete on table public.commands        to authenticated;

-- anon role: KHÔNG grant — user chưa đăng nhập không thấy gì
-- (anon chỉ cần dùng claim_device nếu có pair code, nhưng RPC đó là security definer nên không cần grant table)

-- Grant execute trên RPC claim_device cho cả anon lẫn authenticated
-- (anon cần để gọi trước khi có session, authenticated cần sau khi login)
grant execute on function public.claim_device(text, text, bytea) to anon, authenticated;
