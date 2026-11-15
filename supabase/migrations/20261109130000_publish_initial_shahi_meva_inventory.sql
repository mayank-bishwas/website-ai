create or replace function public.protect_catalog_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'product_families' then
    if new.family_code is distinct from old.family_code then
      raise exception 'Product family codes are immutable.'
        using errcode = '22023';
    end if;
  elsif tg_table_name = 'products' then
    if new.sku is distinct from old.sku
      or new.family_id is distinct from old.family_id then
      raise exception 'Product SKUs and family assignments are immutable.'
        using errcode = '22023';
    end if;
  end if;

  return new;
end;
$$;

do $$
declare
  imported_skus text[] := array[
    '01A', '01B', '01C',
    '02A', '02B', '02C',
    '03A', '03B', '03C',
    '04A', '04B', '04C',
    '05A', '05B', '05C'
  ];
  matched_count integer;
begin
  select count(*)
    into matched_count
    from public.products
    where sku = any(imported_skus);

  if matched_count <> cardinality(imported_skus) then
    raise exception 'Expected exactly 15 imported Shahi Meva SKUs; found %.', matched_count;
  end if;

  if exists (
    select 1
      from public.products
      where sku = any(imported_skus)
        and archived_at is not null
  ) then
    raise exception 'One or more imported Shahi Meva SKUs are archived; refusing to publish them.';
  end if;

  update public.products
    set publication_status = 'published'
    where sku = any(imported_skus)
      and archived_at is null
      and publication_status = 'draft';

  if exists (
    select 1
      from public.products
      where sku = any(imported_skus)
        and publication_status <> 'published'
  ) then
    raise exception 'One or more imported Shahi Meva SKUs could not be published.';
  end if;
end;
$$;

alter table public.products
  alter column publication_status set default 'published';
