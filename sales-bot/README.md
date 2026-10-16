# SIN AI PawaPay Checkout

This folder contains SIN AI's customer payment page, staff-assisted payment links, PawaPay API handlers, and signed callback receiver. The public SIN AI website at the repository root is separate and remains unchanged.

## Customer payment

Customers open `/pay`, enter their country, phone number, amount, and currency, then continue to the PawaPay payment prompt. Payment confirmation remains a manual SIN AI team check; the signed callback is recorded for reconciliation.

Staff can create a fixed, agreed quote link at `/payment-admin`. Customers can review the payment status at the returned link.

## Deploy to Vercel

1. Set this Vercel project's **Root Directory** to `sales-bot`.
2. Set `PAWAPAY_ENV=sandbox` while testing, and use a Sandbox token from the same environment.
3. Add these server-only variables in Vercel:
   - `PAWAPAY_API_TOKEN`
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_ROLE_KEY` (sensitive)
   - `PAYMENT_LINK_ADMIN_TOKEN` (sensitive, long random value)
   - `PAYMENT_BASE_URL` (the checkout domain)
4. Run `pawapay-callbacks.sql` and `pawapay-payment-links.sql` in the Supabase SQL Editor.
5. Deploy and verify the checkout options endpoint and payment flow in Sandbox. Do not use a live token until Sandbox has been verified.
6. Configure signed deposit callbacks in the same PawaPay environment at `/api/pawapay-callback`.

Never put payment tokens or the Supabase service-role key in browser code or GitHub. The Vercel environment variables are the only place for these secrets.
