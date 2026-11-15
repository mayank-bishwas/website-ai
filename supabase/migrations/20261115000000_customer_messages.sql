-- Customer chatbot conversation logging.
-- Single-table design: every customer and assistant message is one row sharing
-- the anonymous session_id of its chatbot session. No separate conversations or
-- sessions table; merchant conversations and messages are untouched.

create table if not exists public.customer_messages (
  id uuid primary key default gen_random_uuid(),
  merchant_slug text not null default 'shahi-meva'
    check (merchant_slug ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  session_id text not null
    check (session_id ~ '^\S{1,128}$'),
  sender text not null
    check (sender in ('customer', 'assistant')),
  message_text text not null,
  status text not null default 'completed'
    check (status in ('sent', 'completed', 'failed', 'interrupted')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists customer_messages_merchant_session_created_at_idx
  on public.customer_messages (merchant_slug, session_id, created_at);

alter table public.customer_messages enable row level security;

revoke all on table public.customer_messages from anon, authenticated;

grant select, insert on table public.customer_messages to service_role;
