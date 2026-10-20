-- Atomic replacement of the active product catalogue.
--
-- One security-definer function, one transaction. A raised exception rolls
-- back the upserts and the deactivation together, so a failure cannot leave
-- a partially replaced catalogue.
--
-- The function preserves products.id and products.barcode, never deletes a
-- product, and never writes inquiries or inquiry_items. Execute is granted
-- only to service_role.

create or replace function public.replace_active_product_catalogue(
    p_batch text,
    p_products jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_temp, public
as $$
declare
    v_incoming_count integer;
    v_staged_count integer;
    v_active_count integer;
    v_deactivated_count integer;
begin
    if nullif(btrim(coalesce(p_batch, '')), '') is null then
        raise exception 'source batch is required';
    end if;

    if p_products is null
       or jsonb_typeof(p_products) <> 'array'
       or jsonb_array_length(p_products) = 0 then
        raise exception 'products payload must be a non-empty array';
    end if;

    v_incoming_count := jsonb_array_length(p_products);

    create temp table incoming_catalogue (
        product_code text not null,
        chinese_name text not null,
        english_name text not null,
        unit_price numeric(12,4) not null,
        currency text not null,
        dimensions text not null,
        source_file text not null
    ) on commit drop;

    insert into incoming_catalogue (
        product_code,
        chinese_name,
        english_name,
        unit_price,
        currency,
        dimensions,
        source_file
    )
    select
        upper(btrim(item->>'product_code')),
        btrim(item->>'chinese_name'),
        btrim(item->>'english_name'),
        (item->>'unit_price')::numeric(12,4),
        coalesce(nullif(btrim(item->>'currency'), ''), 'USD'),
        btrim(item->>'dimensions'),
        btrim(item->>'source_file')
    from jsonb_array_elements(p_products) as item;

    get diagnostics v_staged_count = row_count;

    if v_staged_count <> v_incoming_count then
        raise exception 'staged row count does not match the payload; rolling back';
    end if;

    if exists (
        select 1
        from incoming_catalogue
        where product_code = ''
           or chinese_name = ''
           or english_name = ''
           or dimensions = ''
           or source_file = ''
           or currency = ''
           or unit_price < 0
    ) then
        raise exception 'incoming catalogue contains an invalid product row; rolling back';
    end if;

    if (select count(*) from incoming_catalogue)
       <> (select count(distinct product_code) from incoming_catalogue) then
        raise exception 'incoming catalogue contains duplicate product codes; rolling back';
    end if;

    if exists (
        select 1
        from public.products as product
        where upper(btrim(product.product_code)) in (
            select product_code from incoming_catalogue
        )
        group by upper(btrim(product.product_code))
        having count(*) > 1
    ) then
        raise exception 'multiple existing products share a normalized product code; rolling back';
    end if;

    -- Snapshot identifiers and barcodes before any product write.
    create temp table barcode_before
    on commit drop
    as
    select id, product_code, barcode
    from public.products;

    -- Match case-insensitively so a stored code keeps its UUID. The stored
    -- code is rewritten to the normalized value. barcode, packaging and
    -- image_url are intentionally absent from this assignment list.
    update public.products as product
    set
        product_code = incoming.product_code,
        chinese_name = incoming.chinese_name,
        english_name = incoming.english_name,
        unit_price = incoming.unit_price,
        currency = incoming.currency,
        dimensions = incoming.dimensions,
        active = true,
        source_batch = p_batch,
        source_file = incoming.source_file,
        updated_at = now()
    from incoming_catalogue as incoming
    where upper(btrim(product.product_code)) = incoming.product_code;

    insert into public.products (
        product_code,
        chinese_name,
        english_name,
        unit_price,
        currency,
        dimensions,
        packaging,
        barcode,
        image_url,
        active,
        source_batch,
        source_file
    )
    select
        incoming.product_code,
        incoming.chinese_name,
        incoming.english_name,
        incoming.unit_price,
        incoming.currency,
        incoming.dimensions,
        null,
        null,
        null,
        true,
        p_batch,
        incoming.source_file
    from incoming_catalogue as incoming
    where not exists (
        select 1
        from public.products as product
        where upper(btrim(product.product_code)) = incoming.product_code
    );

    -- Only after every incoming row has been written.
    update public.products as product
    set
        active = false,
        updated_at = now()
    where product.active = true
      and not exists (
          select 1
          from incoming_catalogue as incoming
          where incoming.product_code = upper(btrim(product.product_code))
      );

    get diagnostics v_deactivated_count = row_count;

    if exists (
        select 1
        from barcode_before as before
        where not exists (
            select 1
            from public.products as product
            where product.id = before.id
        )
    ) then
        raise exception 'a product row disappeared; rolling back';
    end if;

    if (select count(*) from public.products) < (select count(*) from barcode_before) then
        raise exception 'products were deleted; rolling back';
    end if;

    if exists (
        select 1
        from public.products as product
        join barcode_before as before on before.id = product.id
        where product.barcode is distinct from before.barcode
    ) then
        raise exception 'a product barcode changed; rolling back';
    end if;

    select count(*)
    into v_active_count
    from public.products
    where active = true;

    if v_active_count <> v_incoming_count then
        raise exception 'active product count does not match the incoming catalogue; rolling back';
    end if;

    if exists (
        select 1
        from public.products
        where active = true
          and source_batch is distinct from p_batch
    ) then
        raise exception 'an active product is outside the incoming batch; rolling back';
    end if;

    if exists (
        select 1
        from public.products
        where active = true
        group by product_code
        having count(*) > 1
    ) then
        raise exception 'active product codes are not unique; rolling back';
    end if;

    return jsonb_build_object(
        'incoming', v_incoming_count,
        'active', v_active_count,
        'deactivated', v_deactivated_count
    );
end;
$$;

comment on function public.replace_active_product_catalogue(text, jsonb) is
    'Replaces the active product catalogue in one transaction. Service role only. Preserves product UUIDs and barcodes. Does not delete products or modify inquiries.';

revoke all on function public.replace_active_product_catalogue(text, jsonb)
    from public, anon, authenticated;

grant execute on function public.replace_active_product_catalogue(text, jsonb)
    to service_role;
