create table if not exists public.pawapay_callbacks (
  operation_type text not null check (operation_type in ('DEPOSIT', 'CHECKOUT', 'PAYOUT', 'REFUND', 'REMITTANCE')),
  transaction_id text not null,
  status text not null,
  amount text,
  currency text,
  country text,
  provider_transaction_id text,
  callback_created_at timestamptz,
  received_at timestamptz not null default now(),
  primary key (operation_type, transaction_id)
);

alter table public.pawapay_callbacks enable row level security;

-- No browser-facing policies are added. Only the server's Supabase service-role
-- key can write or read this table; never expose that key in frontend code.
