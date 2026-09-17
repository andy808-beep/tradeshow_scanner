-- Enable RLS without browser-facing CRUD policies. Application data continues
-- to go through Next.js route handlers using the service-role client, which
-- bypasses RLS. Rerunning ENABLE is a no-op when RLS is already on.

alter table public.products enable row level security;
alter table public.inquiries enable row level security;
alter table public.inquiry_items enable row level security;

-- Lock the inquiry RPC to the service role. Signature matches
-- 001_initial_schema.sql: create_trade_show_inquiry(
--   p_customer_name text,
--   p_company_name text,
--   p_staff_name text,
--   p_notes text,
--   p_currency text,
--   p_items jsonb
-- )

revoke all on function public.create_trade_show_inquiry(text, text, text, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.create_trade_show_inquiry(text, text, text, text, text, jsonb)
  to service_role;
