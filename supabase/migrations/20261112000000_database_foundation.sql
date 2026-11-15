-- Shahi Meva content and audit foundation.
-- This migration intentionally does not touch conversations, messages, or storage.

alter table public.products
  add column if not exists variant_unit text,
  add column if not exists currency text;

alter table public.products
  add constraint products_variant_unit_nonempty
    check (variant_unit is null or length(btrim(variant_unit)) > 0),
  add constraint products_currency_allowed
    check (
      currency is null
      or currency in ('INR', 'USD', 'EUR', 'AED', 'GBP', 'CAD', 'AUD')
    );

-- Existing variant strings and prices are preserved as-is. The new columns remain
-- nullable until a reviewed backfill assigns units and currencies to legacy rows.
-- Legacy image_3 and entry_notes columns are intentionally retained.

create table if not exists public.knowledge_entries (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  content text not null check (length(btrim(content)) > 0),
  status text not null default 'published'
    check (status in ('published', 'archived'))
);

create table if not exists public.knowledge_audit_logs (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.knowledge_entries(id) on delete restrict,
  action text not null check (length(btrim(action)) > 0),
  before_value jsonb,
  after_value jsonb,
  actor text not null check (actor in ('merchant', 'administrator', 'agent')),
  created_at timestamptz not null default now()
);

create index if not exists knowledge_audit_logs_record_created_at_idx
  on public.knowledge_audit_logs (record_id, created_at desc);

create table if not exists public.website_content (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  source_url text not null check (length(btrim(source_url)) > 0),
  content text not null check (length(btrim(content)) > 0),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'archived'))
);

create unique index if not exists website_content_one_active_idx
  on public.website_content ((status))
  where status = 'active';

create table if not exists public.website_content_audit_logs (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.website_content(id) on delete restrict,
  action text not null check (length(btrim(action)) > 0),
  before_value jsonb,
  after_value jsonb,
  actor text not null check (actor in ('merchant', 'administrator', 'agent')),
  created_at timestamptz not null default now()
);

create index if not exists website_content_audit_logs_record_created_at_idx
  on public.website_content_audit_logs (record_id, created_at desc);

create or replace function public.content_audit_actor()
returns text
language sql
stable
set search_path = ''
as $$
  select case current_setting('app.audit_actor', true)
    when 'merchant' then 'merchant'
    when 'agent' then 'agent'
    else 'administrator'
  end;
$$;

create or replace function public.set_content_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create or replace function public.audit_product_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
  actor_name text := public.content_audit_actor();
begin
  if tg_op = 'INSERT' then
    audit_action := case
      when new.publication_status = 'published' then 'publish'
      else 'create'
    end;

    insert into public.inventory_audit_logs (
      sku, action, before_value, after_value, actor
    )
    values (
      new.sku, audit_action, null, pg_catalog.to_jsonb(new), actor_name
    );

    return new;
  end if;

  if (pg_catalog.to_jsonb(new) - 'updated_at')
      is not distinct from
     (pg_catalog.to_jsonb(old) - 'updated_at') then
    return new;
  end if;

  audit_action := case
    when old.archived_at is null and new.archived_at is not null then 'archive'
    when old.archived_at is not null and new.archived_at is null then 'restore'
    when old.publication_status <> 'published' and new.publication_status = 'published' then 'publish'
    when old.publication_status = 'published' and new.publication_status <> 'published' then 'unpublish'
    else 'update'
  end;

  insert into public.inventory_audit_logs (
    sku, action, before_value, after_value, actor
  )
  values (
    new.sku, audit_action, pg_catalog.to_jsonb(old), pg_catalog.to_jsonb(new), actor_name
  );

  return new;
end;
$$;

create or replace function public.audit_knowledge_entry_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
begin
  if tg_op = 'INSERT' then
    audit_action := case
      when new.status = 'published' then 'publish'
      else 'create'
    end;

    insert into public.knowledge_audit_logs (
      record_id, action, before_value, after_value, actor
    )
    values (
      new.id, audit_action, null, pg_catalog.to_jsonb(new), public.content_audit_actor()
    );

    return new;
  end if;

  if (pg_catalog.to_jsonb(new) - 'updated_at')
      is not distinct from
     (pg_catalog.to_jsonb(old) - 'updated_at') then
    return new;
  end if;

  audit_action := case
    when old.status = 'published' and new.status = 'archived' then 'archive'
    when old.status = 'archived' and new.status = 'published' then 'publish'
    else 'update'
  end;

  insert into public.knowledge_audit_logs (
    record_id, action, before_value, after_value, actor
  )
  values (
    new.id, audit_action, pg_catalog.to_jsonb(old), pg_catalog.to_jsonb(new),
    public.content_audit_actor()
  );

  return new;
end;
$$;

create or replace function public.activate_website_content()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    perform pg_catalog.pg_advisory_xact_lock(730203, 1);

    update public.website_content
      set status = 'archived'
      where status = 'active'
        and id <> new.id;
  end if;

  return new;
end;
$$;

create or replace function public.audit_website_content_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  audit_action text;
begin
  if tg_op = 'INSERT' then
    insert into public.website_content_audit_logs (
      record_id, action, before_value, after_value, actor
    )
    values (
      new.id,
      case when new.status = 'active' then 'activate' else 'create' end,
      null,
      pg_catalog.to_jsonb(new),
      public.content_audit_actor()
    );

    return new;
  end if;

  if (pg_catalog.to_jsonb(new) - 'updated_at')
      is not distinct from
     (pg_catalog.to_jsonb(old) - 'updated_at') then
    return new;
  end if;

  audit_action := case
    when old.status <> 'active' and new.status = 'active' then 'activate'
    when old.status = 'active' and new.status = 'archived' then 'archive'
    else 'update'
  end;

  insert into public.website_content_audit_logs (
    record_id, action, before_value, after_value, actor
  )
  values (
    new.id, audit_action, pg_catalog.to_jsonb(old), pg_catalog.to_jsonb(new),
    public.content_audit_actor()
  );

  return new;
end;
$$;

drop trigger if exists products_audit_versions on public.products;
create trigger products_audit_versions
after insert or update on public.products
for each row execute function public.audit_product_version();

drop trigger if exists knowledge_entries_set_updated_at on public.knowledge_entries;
create trigger knowledge_entries_set_updated_at
before update on public.knowledge_entries
for each row execute function public.set_content_updated_at();

drop trigger if exists knowledge_entries_audit_versions on public.knowledge_entries;
create trigger knowledge_entries_audit_versions
after insert or update on public.knowledge_entries
for each row execute function public.audit_knowledge_entry_version();

drop trigger if exists website_content_activate_one on public.website_content;
create trigger website_content_activate_one
before insert or update on public.website_content
for each row execute function public.activate_website_content();

drop trigger if exists website_content_set_updated_at on public.website_content;
create trigger website_content_set_updated_at
before update on public.website_content
for each row execute function public.set_content_updated_at();

drop trigger if exists website_content_audit_versions on public.website_content;
create trigger website_content_audit_versions
after insert or update on public.website_content
for each row execute function public.audit_website_content_version();

alter table public.knowledge_entries enable row level security;
alter table public.knowledge_audit_logs enable row level security;
alter table public.website_content enable row level security;
alter table public.website_content_audit_logs enable row level security;

revoke all on table
  public.knowledge_entries,
  public.knowledge_audit_logs,
  public.website_content,
  public.website_content_audit_logs
from anon, authenticated;

grant select, insert, update on table
  public.knowledge_entries,
  public.website_content
to service_role;

grant select, insert on table
  public.knowledge_audit_logs,
  public.website_content_audit_logs
to service_role;

revoke update, delete on table public.inventory_audit_logs from service_role;
grant select, insert on table public.inventory_audit_logs to service_role;

revoke all on function public.content_audit_actor() from public, anon, authenticated;
revoke all on function public.set_content_updated_at() from public, anon, authenticated;
revoke all on function public.audit_product_version() from public, anon, authenticated;
revoke all on function public.audit_knowledge_entry_version() from public, anon, authenticated;
revoke all on function public.activate_website_content() from public, anon, authenticated;
revoke all on function public.audit_website_content_version() from public, anon, authenticated;
