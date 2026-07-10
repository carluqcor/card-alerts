create table if not exists targets (
  id uuid primary key default gen_random_uuid(),
  site text not null,
  url text not null,
  name text not null,
  active boolean not null default true,
  price_selector text,
  stock_selector text,
  image_url text,
  created_at timestamptz not null default now()
);

create table if not exists checks (
  id bigint generated always as identity primary key,
  target_id uuid not null references targets(id) on delete cascade,
  checked_at timestamptz not null default now(),
  price numeric,
  currency text,
  in_stock boolean,
  original_price numeric,
  promo_label text,
  campaign_label text,
  raw jsonb
);

create index if not exists checks_target_id_checked_at_idx
  on checks (target_id, checked_at desc);

alter table targets enable row level security;
alter table checks enable row level security;

-- Dashboard reads with the anon key; scraper writes with the service role key
-- (service role bypasses RLS entirely, so these policies only govern anon access).
create policy "Public read access to targets"
  on targets for select
  using (true);

create policy "Public read access to checks"
  on checks for select
  using (true);
