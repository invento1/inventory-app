-- Bulk item import (Items -> Import Items). The page parses and previews the
-- CSV; this RPC re-validates every row server-side and creates the items in
-- one transaction: all rows or none. SKUs come from next_item_sku, exactly as
-- New Item does.
--
-- p_rows: [{row, name, barcode, description, unit, unit_price,
--           reorder_threshold, category, brand, supplier, is_active}, ...]
--   row          the CSV line number, echoed back in errors ("Row 7: ...")
--   category     "Name" or a path "Parent > Child"
--   unit         a unit's abbreviation or name (blank = 'unit')
-- p_create_missing: create categories / brands / units / suppliers that don't
--   exist yet (needs settings.master_data / suppliers.create); otherwise an
--   unknown name is an error.
--
-- Refused rows: a name that already exists in the org (re-importing the same
-- file must not duplicate items), a barcode already in use (scanning would
-- pick the wrong item), and duplicates within the batch.

create or replace function public.import_resolve_category(
  p_org_id uuid, p_path text, p_create boolean, p_row int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_parts text[];
  v_part text;
  v_parent uuid := null;
  v_id uuid;
  v_count int;
begin
  v_parts := array(select trim(p) from unnest(string_to_array(p_path, '>')) p where trim(p) <> '');
  if array_length(v_parts, 1) is null then
    return null;
  end if;

  -- A single name matches a category at any level, if it's unambiguous.
  if array_length(v_parts, 1) = 1 then
    select count(*), min(id::text)::uuid into v_count, v_id
    from categories where org_id = p_org_id and lower(name) = lower(v_parts[1]);
    if v_count = 1 then
      return v_id;
    elsif v_count > 1 then
      raise exception 'Row %: more than one category is called "%". Write the full path, e.g. "Parent > %"',
        p_row, v_parts[1], v_parts[1];
    end if;
  end if;

  foreach v_part in array v_parts loop
    select id into v_id from categories
    where org_id = p_org_id and lower(name) = lower(v_part) and parent_id is not distinct from v_parent;
    if v_id is null then
      if not p_create then
        raise exception 'Row %: category "%" doesn''t exist', p_row, p_path;
      end if;
      perform assert_permission(p_org_id, 'settings.master_data');
      insert into categories (org_id, name, parent_id) values (p_org_id, v_part, v_parent) returning id into v_id;
    end if;
    v_parent := v_id;
  end loop;
  return v_parent;
end;
$$;

revoke execute on function public.import_resolve_category(uuid, text, boolean, int) from public, authenticated, anon;

create or replace function public.import_items(p_org_id uuid, p_rows jsonb, p_create_missing boolean default false)
returns table (row_no int, new_item_id uuid, new_sku text, item_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row jsonb;
  v_n int;
  v_name text;
  v_barcode text;
  v_description text;
  v_unit_text text;
  v_unit text;
  v_price numeric;
  v_reorder numeric;
  v_active boolean;
  v_text text;
  v_category_id uuid;
  v_brand_id uuid;
  v_supplier_id uuid;
  v_existing_sku text;
  v_names text[] := '{}';
  v_barcodes text[] := '{}';
  v_id uuid;
  v_sku text;
begin
  perform assert_permission(p_org_id, 'items.create');

  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'There are no items to import';
  end if;
  if jsonb_array_length(p_rows) > 2000 then
    raise exception 'Import at most 2,000 items at a time';
  end if;

  for v_row in select * from jsonb_array_elements(p_rows)
  loop
    v_n := coalesce((v_row ->> 'row')::int, 0);

    -- Name
    v_name := nullif(trim(v_row ->> 'name'), '');
    if v_name is null then
      raise exception 'Row %: Name is required', v_n;
    end if;
    if lower(v_name) = any(v_names) then
      raise exception 'Row %: "%" appears more than once in the file', v_n, v_name;
    end if;
    select sku into v_existing_sku from items where org_id = p_org_id and lower(trim(name)) = lower(v_name) limit 1;
    if v_existing_sku is not null then
      raise exception 'Row %: "%" already exists (SKU %)', v_n, v_name, v_existing_sku;
    end if;
    v_names := v_names || lower(v_name);

    -- Barcode
    v_barcode := nullif(trim(v_row ->> 'barcode'), '');
    if v_barcode is not null then
      if v_barcode = any(v_barcodes) then
        raise exception 'Row %: barcode % appears more than once in the file', v_n, v_barcode;
      end if;
      select sku into v_existing_sku from items where org_id = p_org_id and barcode = v_barcode limit 1;
      if v_existing_sku is not null then
        raise exception 'Row %: barcode % is already used by SKU %', v_n, v_barcode, v_existing_sku;
      end if;
      v_barcodes := v_barcodes || v_barcode;
    end if;

    v_description := nullif(trim(v_row ->> 'description'), '');

    -- Price (required, >= 0) and reorder level (optional, >= 0)
    begin
      v_price := (nullif(trim(v_row ->> 'unit_price'), ''))::numeric;
      v_reorder := (nullif(trim(v_row ->> 'reorder_threshold'), ''))::numeric;
    exception when invalid_text_representation then
      raise exception 'Row %: Selling Price and Reorder Level must be numbers', v_n;
    end;
    if v_price is null then
      raise exception 'Row %: Selling Price is required', v_n;
    end if;
    if v_price < 0 or coalesce(v_reorder, 0) < 0 then
      raise exception 'Row %: Selling Price and Reorder Level can''t be negative', v_n;
    end if;

    -- Active (blank = yes)
    v_text := lower(coalesce(nullif(trim(v_row ->> 'is_active'), ''), 'yes'));
    if v_text in ('yes', 'y', 'true', '1', 'active') then
      v_active := true;
    elsif v_text in ('no', 'n', 'false', '0', 'inactive') then
      v_active := false;
    else
      raise exception 'Row %: Active must be yes or no', v_n;
    end if;

    -- Unit: matched on abbreviation or name; stored like New Item does.
    v_unit_text := nullif(trim(v_row ->> 'unit'), '');
    if v_unit_text is null then
      v_unit := 'unit';
    else
      select coalesce(nullif(abbreviation, ''), name) into v_unit
      from units_of_measure
      where org_id = p_org_id and (lower(abbreviation) = lower(v_unit_text) or lower(name) = lower(v_unit_text))
      limit 1;
      if v_unit is null then
        if lower(v_unit_text) = 'unit' then
          v_unit := 'unit';
        elsif p_create_missing then
          perform assert_permission(p_org_id, 'settings.master_data');
          insert into units_of_measure (org_id, name) values (p_org_id, v_unit_text);
          v_unit := v_unit_text;
        else
          raise exception 'Row %: unit "%" doesn''t exist', v_n, v_unit_text;
        end if;
      end if;
    end if;

    -- Category
    v_text := nullif(trim(v_row ->> 'category'), '');
    v_category_id := case when v_text is null then null
                          else import_resolve_category(p_org_id, v_text, p_create_missing, v_n) end;

    -- Brand
    v_brand_id := null;
    v_text := nullif(trim(v_row ->> 'brand'), '');
    if v_text is not null then
      select id into v_brand_id from brands where org_id = p_org_id and lower(name) = lower(v_text) limit 1;
      if v_brand_id is null then
        if not p_create_missing then
          raise exception 'Row %: brand "%" doesn''t exist', v_n, v_text;
        end if;
        perform assert_permission(p_org_id, 'settings.master_data');
        insert into brands (org_id, name) values (p_org_id, v_text) returning id into v_brand_id;
      end if;
    end if;

    -- Supplier
    v_supplier_id := null;
    v_text := nullif(trim(v_row ->> 'supplier'), '');
    if v_text is not null then
      select id into v_supplier_id from suppliers where org_id = p_org_id and lower(name) = lower(v_text) limit 1;
      if v_supplier_id is null then
        if not p_create_missing then
          raise exception 'Row %: supplier "%" doesn''t exist', v_n, v_text;
        end if;
        perform assert_permission(p_org_id, 'suppliers.create');
        insert into suppliers (org_id, name) values (p_org_id, v_text) returning id into v_supplier_id;
      end if;
    end if;

    v_sku := next_item_sku(p_org_id);
    insert into items (org_id, sku, name, barcode, description, unit, unit_price, reorder_threshold,
                       is_active, category_id, brand_id, supplier_id)
    values (p_org_id, v_sku, v_name, v_barcode, v_description, v_unit, v_price, v_reorder,
            v_active, v_category_id, v_brand_id, v_supplier_id)
    returning id into v_id;

    row_no := v_n;
    new_item_id := v_id;
    new_sku := v_sku;
    item_name := v_name;
    return next;
  end loop;
end;
$$;
