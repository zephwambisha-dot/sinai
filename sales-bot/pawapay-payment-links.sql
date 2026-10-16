create table if not exists public.pawapay_payment_links (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  reference text not null check (char_length(reference) between 1 and 80),
  amount numeric(21, 3) not null check (amount > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (char_length(reason) between 1 and 50),
  status text not null default 'OPEN' check (status in ('OPEN', 'INITIATING', 'PROCESSING', 'PAID')),
  provider_status text,
  country text,
  phone_number text,
  manual_review_status text not null default 'PENDING',
  manual_reviewed_at timestamptz,
  deposit_id uuid unique,
  redirect_url text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pawapay_payment_links_expires_at_idx
  on public.pawapay_payment_links (expires_at);

alter table public.pawapay_payment_links enable row level security;
revoke all on public.pawapay_payment_links from anon, authenticated;
grant select, insert, update on public.pawapay_payment_links to service_role;

-- Existing installations: add the fields used by the customer-entered checkout.
alter table public.pawapay_payment_links
  add column if not exists country text,
  add column if not exists phone_number text,
  add column if not exists manual_review_status text not null default 'PENDING',
  add column if not exists manual_reviewed_at timestamptz;
