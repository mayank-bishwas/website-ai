create table public.product_families (
  id uuid primary key default gen_random_uuid(),
  family_code text not null unique,
  family_name text not null check (length(btrim(family_name)) > 0),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint product_families_family_code_format
    check (family_code ~ '^(0[1-9]|[1-9][0-9])$')
);

create table public.products (
  sku text primary key,
  image_1 text,
  image_2 text,
  image_3 text,
  product_name text not null check (length(btrim(product_name)) > 0),
  description text not null default '',
  variant text not null check (length(btrim(variant)) > 0),
  price numeric(12, 2) not null check (price >= 0),
  entry_notes text,
  family_id uuid not null references public.product_families(id) on delete restrict,
  publication_status text not null default 'draft'
    check (publication_status in ('draft', 'published')),
  availability text not null default 'in_stock'
    check (availability in ('in_stock', 'out_of_stock')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint products_sku_format check (sku ~ '^[0-9]{2}[A-Z]$')
);

create table public.inventory_audit_logs (
  id uuid primary key default gen_random_uuid(),
  sku text not null,
  action text not null check (length(btrim(action)) > 0),
  before_value jsonb,
  after_value jsonb,
  actor text not null check (actor in ('merchant', 'administrator', 'agent')),
  created_at timestamptz not null default now()
);

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  browser_token text not null unique check (length(btrim(browser_token)) > 0)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender text not null check (sender in ('user', 'agent')),
  mode text not null check (mode in ('ASK', 'EDIT')),
  message_text text not null,
  created_at timestamptz not null default now(),
  status text not null default 'sent'
    check (status in ('sent', 'processing', 'completed', 'failed'))
);

create function public.touch_conversation_last_message_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  update public.conversations
    set last_message_at = greatest(last_message_at, new.created_at)
    where id = new.conversation_id;

  return new;
end;
$$;

create trigger messages_touch_conversation
after insert on public.messages
for each row execute function public.touch_conversation_last_message_at();

create index products_active_family_idx
  on public.products (family_id, sku)
  where archived_at is null;

create index products_active_availability_idx
  on public.products (availability)
  where archived_at is null;

create index inventory_audit_logs_sku_created_at_idx
  on public.inventory_audit_logs (sku, created_at desc);

create index conversations_last_message_at_idx
  on public.conversations (last_message_at desc);

create index messages_conversation_created_at_idx
  on public.messages (conversation_id, created_at);

create function public.assign_product_family_code()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_code integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(730201, 0);

  if new.family_code is null or btrim(new.family_code) = '' then
    select coalesce(max(family_code::integer), 0) + 1
      into next_code
      from public.product_families;

    if next_code > 99 then
      raise exception 'No product family codes remain (01–99).'
        using errcode = '22023';
    end if;

    new.family_code := lpad(next_code::text, 2, '0');
  end if;

  return new;
end;
$$;

create trigger product_families_assign_code
before insert on public.product_families
for each row execute function public.assign_product_family_code();

create function public.assign_product_sku()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  family_code text;
  family_archived_at timestamptz;
  next_letter text;
begin
  perform pg_catalog.pg_advisory_xact_lock(730202, pg_catalog.hashtext(new.family_id::text));

  select product_families.family_code, product_families.archived_at
    into family_code, family_archived_at
    from public.product_families
    where product_families.id = new.family_id
    for share;

  if not found then
    raise exception 'Product family does not exist.'
      using errcode = '23503';
  end if;

  if family_archived_at is not null then
    raise exception 'Cannot add a product to an archived family.'
      using errcode = '22023';
  end if;

  if new.sku is null or btrim(new.sku) = '' then
    select pg_catalog.chr(candidate.letter)
      into next_letter
      from pg_catalog.generate_series(65, 90) as candidate(letter)
      where not exists (
        select 1
          from public.products
          where products.family_id = new.family_id
            and products.sku = family_code || pg_catalog.chr(candidate.letter)
      )
      order by candidate.letter
      limit 1;

    if next_letter is null then
      raise exception 'No product variant letters remain (A–Z) for this family.'
        using errcode = '22023';
    end if;

    new.sku := family_code || next_letter;
  elsif new.sku !~ ('^' || family_code || '[A-Z]$') then
    raise exception 'SKU must use the family code and a single variant letter (A–Z).'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger products_assign_sku
before insert on public.products
for each row execute function public.assign_product_sku();

create function public.set_product_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := pg_catalog.now();
  return new;
end;
$$;

create trigger products_set_updated_at
before update on public.products
for each row execute function public.set_product_updated_at();

create function public.protect_catalog_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'product_families'
    and new.family_code is distinct from old.family_code then
    raise exception 'Product family codes are immutable.'
      using errcode = '22023';
  end if;

  if tg_table_name = 'products'
    and (
      new.sku is distinct from old.sku
      or new.family_id is distinct from old.family_id
    ) then
    raise exception 'Product SKUs and family assignments are immutable.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

create trigger product_families_protect_identity
before update on public.product_families
for each row execute function public.protect_catalog_identity();

create trigger products_protect_identity
before update on public.products
for each row execute function public.protect_catalog_identity();

create function public.prevent_catalog_hard_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Catalog records cannot be deleted; archive them instead.'
    using errcode = '22023';
end;
$$;

create trigger product_families_prevent_delete
before delete on public.product_families
for each row execute function public.prevent_catalog_hard_delete();

create trigger products_prevent_delete
before delete on public.products
for each row execute function public.prevent_catalog_hard_delete();

alter table public.product_families enable row level security;
alter table public.products enable row level security;
alter table public.inventory_audit_logs enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;

revoke all on table
  public.product_families,
  public.products,
  public.inventory_audit_logs,
  public.conversations,
  public.messages
from anon, authenticated;

grant select, insert, update on table
  public.product_families,
  public.products,
  public.inventory_audit_logs,
  public.conversations,
  public.messages
to service_role;

revoke all on function public.assign_product_family_code() from public, anon, authenticated;
revoke all on function public.assign_product_sku() from public, anon, authenticated;
revoke all on function public.set_product_updated_at() from public, anon, authenticated;
revoke all on function public.protect_catalog_identity() from public, anon, authenticated;
revoke all on function public.prevent_catalog_hard_delete() from public, anon, authenticated;
revoke all on function public.touch_conversation_last_message_at() from public, anon, authenticated;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'product-images',
  'product-images',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
