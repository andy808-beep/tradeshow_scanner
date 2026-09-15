create extension if not exists pgcrypto;

create table if not exists products (
    id uuid primary key default gen_random_uuid(),
    product_code text not null unique,
    barcode text unique,
    chinese_name text,
    english_name text,
    unit_price numeric(12,4),
    currency text not null default 'USD',
    dimensions text,
    packaging text,
    image_url text,
    active boolean not null default true,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create table if not exists inquiries (
    id uuid primary key default gen_random_uuid(),
    customer_name text not null,
    company_name text,
    staff_name text,
    notes text,
    currency text not null default 'USD',
    status text not null default 'draft',
    created_at timestamptz not null default now()
);

create table if not exists inquiry_items (
    id uuid primary key default gen_random_uuid(),
    inquiry_id uuid not null
        references inquiries(id) on delete cascade,
    product_id uuid not null
        references products(id),
    product_code_snapshot text not null,
    product_name_snapshot text,
    quantity integer not null check (quantity > 0),
    quoted_price numeric(12,4),
    notes text
);

create index if not exists idx_inquiry_items_inquiry_id
    on inquiry_items(inquiry_id);

insert into products (
    product_code,
    barcode,
    chinese_name,
    english_name,
    unit_price,
    currency,
    dimensions,
    packaging,
    active
)
values (
    'K10188-13',
    null,
    '大方盘·紫',
    'Abbesses Plate - L',
    null,
    'USD',
    '20.6 × 13.3 × 2.0 cm',
    null,
    true
)
on conflict (product_code) do nothing;

create or replace function create_trade_show_inquiry(
    p_customer_name text,
    p_company_name text,
    p_staff_name text,
    p_notes text,
    p_currency text,
    p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_inquiry_id uuid;
    v_inserted_count integer;
begin
    if nullif(trim(p_customer_name), '') is null then
        raise exception 'Customer name is required';
    end if;

    if p_items is null
       or jsonb_typeof(p_items) <> 'array'
       or jsonb_array_length(p_items) = 0 then
        raise exception 'At least one product is required';
    end if;

    insert into inquiries (
        customer_name,
        company_name,
        staff_name,
        notes,
        currency
    )
    values (
        trim(p_customer_name),
        nullif(trim(coalesce(p_company_name, '')), ''),
        nullif(trim(coalesce(p_staff_name, '')), ''),
        nullif(trim(coalesce(p_notes, '')), ''),
        coalesce(nullif(trim(p_currency), ''), 'USD')
    )
    returning id into v_inquiry_id;

    insert into inquiry_items (
        inquiry_id,
        product_id,
        product_code_snapshot,
        product_name_snapshot,
        quantity,
        quoted_price,
        notes
    )
    select
        v_inquiry_id,
        product.id,
        product.product_code,
        coalesce(
            product.english_name,
            product.chinese_name,
            product.product_code
        ),
        (item->>'quantity')::integer,
        nullif(item->>'quotedPrice', '')::numeric,
        nullif(trim(coalesce(item->>'notes', '')), '')
    from jsonb_array_elements(p_items) as item
    join products as product
      on product.id = (item->>'productId')::uuid
     and product.active = true
    where (item->>'quantity')::integer > 0
      and (
          nullif(item->>'quotedPrice', '') is null
          or (item->>'quotedPrice')::numeric >= 0
      );

    get diagnostics v_inserted_count = row_count;

    if v_inserted_count <> jsonb_array_length(p_items) then
        raise exception
            'One or more inquiry items contain an invalid or inactive product, quantity, or price';
    end if;

    return v_inquiry_id;
end;
$$;