-- Idempotent inquiry submission. Historical rows keep a null client_submission_id.
-- Quantity remains 1 inside the RPC. Existing inquiries and items are not rewritten.

alter table public.inquiries
  add column if not exists client_submission_id uuid;

create unique index if not exists inquiries_client_submission_id_uidx
  on public.inquiries (client_submission_id)
  where client_submission_id is not null;

-- New overload: the existing 6-argument function is kept as a wrapper so
-- older application servers continue to work during deploy.

create or replace function public.create_trade_show_inquiry(
    p_customer_name text,
    p_company_name text,
    p_staff_name text,
    p_notes text,
    p_currency text,
    p_items jsonb,
    p_client_submission_id uuid
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

    if p_client_submission_id is not null then
        select id
          into v_inquiry_id
          from inquiries
         where client_submission_id = p_client_submission_id;

        if v_inquiry_id is not null then
            return v_inquiry_id;
        end if;
    end if;

    begin
        insert into inquiries (
            customer_name,
            company_name,
            staff_name,
            notes,
            currency,
            client_submission_id
        )
        values (
            trim(p_customer_name),
            nullif(trim(coalesce(p_company_name, '')), ''),
            nullif(trim(coalesce(p_staff_name, '')), ''),
            nullif(trim(coalesce(p_notes, '')), ''),
            coalesce(nullif(trim(p_currency), ''), 'USD'),
            p_client_submission_id
        )
        returning id into v_inquiry_id;
    exception
        when unique_violation then
            -- A concurrent retry with the same clientSubmissionId committed first.
            select id
              into v_inquiry_id
              from inquiries
             where client_submission_id = p_client_submission_id;

            if v_inquiry_id is null then
                raise;
            end if;

            return v_inquiry_id;
    end;

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
        1,
        nullif(item->>'quotedPrice', '')::numeric,
        nullif(trim(coalesce(item->>'notes', '')), '')
    from jsonb_array_elements(p_items) as item
    join products as product
      on product.id = (item->>'productId')::uuid
     and product.active = true
    where (
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

create or replace function public.create_trade_show_inquiry(
    p_customer_name text,
    p_company_name text,
    p_staff_name text,
    p_notes text,
    p_currency text,
    p_items jsonb
)
returns uuid
language sql
security definer
set search_path = public
as $$
    select public.create_trade_show_inquiry(
        p_customer_name,
        p_company_name,
        p_staff_name,
        p_notes,
        p_currency,
        p_items,
        null
    );
$$;

revoke all on function public.create_trade_show_inquiry(text, text, text, text, text, jsonb, uuid)
  from public, anon, authenticated;

grant execute on function public.create_trade_show_inquiry(text, text, text, text, text, jsonb, uuid)
  to service_role;

revoke all on function public.create_trade_show_inquiry(text, text, text, text, text, jsonb)
  from public, anon, authenticated;

grant execute on function public.create_trade_show_inquiry(text, text, text, text, text, jsonb)
  to service_role;
