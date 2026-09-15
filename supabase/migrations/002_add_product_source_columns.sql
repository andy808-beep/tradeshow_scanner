alter table public.products
    add column if not exists source_batch text;

alter table public.products
    add column if not exists source_file text;
