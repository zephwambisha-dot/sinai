# SIN AI Sales Bot Website

This is the first website version of the SIN AI Sales Bot. It includes a public product page plus the working bot app on the same site.

## What It Does

- Presents the product as a client-facing website.
- Replies to customer messages using a configurable business profile.
- Lets each business owner add a master instruction prompt, business background, and preferred reply style.
- Uses a backend API when running with `npm start`.
- Can use OpenAI or Gemini from the backend when an API key is configured.
- Can use internet search for requests such as current information, suppliers, companies, leads, and B2B contact research when search is enabled.
- Answers service, price, booking, and payment questions.
- Qualifies leads by need, timeframe, budget, and contact.
- Scores leads from 0 to 100.
- Marks serious leads as ready for human handoff.
- Saves leads in the browser with `localStorage`.
- Saves leads to `data/leads.json` when the backend is running.
- Exports saved leads as CSV.
- Generates reusable sales scripts for WhatsApp, website chat, or manual outreach.

## How To Run

### Demo Website Only

Open `index.html` in a browser.

No server, install, or internet connection is required. In this mode, replies are rule-based and leads are stored only in the browser.

### Website With Backend API

Run:

```powershell
npm start
```

Then open:

```text
http://127.0.0.1:8088
```

In this mode, the website talks to `server.js`, and leads are saved in `data/leads.json`.

### AI API Mode

1. Copy `.env.example` to `.env`.
2. Choose `AI_PROVIDER=openai` or `AI_PROVIDER=gemini`.
3. Add the matching key: `OPENAI_API_KEY` or `GEMINI_API_KEY`.
3. Run `npm start`.

The API key stays on the server. Do not put it inside `app.js` or any public frontend file.

Optional:

- `OPENAI_MODEL` controls the OpenAI model.
- `GEMINI_MODEL` controls the Gemini model.
- `ENABLE_WEB_SEARCH=false` disables search globally.
- `BRAVE_SEARCH_API_KEY` enables Brave Search as the dedicated search provider. Without it, the app tries the active AI provider's native web search where available.
- `HOT_LEAD_WEBHOOK_URL` sends hot leads to another automation/webhook endpoint.

## PawaPay Checkout and Callbacks

The SIN AI marketing site and project tracker are static GitHub Pages files; they cannot receive PawaPay server-to-server POST requests. This repo includes a Vercel API callback receiver at `api/pawapay-callback.js`.

The customer checkout uses PawaPay's hosted Payment Page. Customers can open `/pay`, enter the amount and currency SIN AI already agreed with them, and provide their quote reference. The server validates the entry against PawaPay's currently enabled deposit options and saves an immutable quote before checkout. PawaPay then presents the countries and mobile money options currently enabled on the account. A PawaPay session is created when the customer continues to payment, so the quote link's 30-day validity is separate from the provider's 15-minute session limit. SIN AI must match the payment to its quote before starting work. Staff can also create a link in `/payment-admin` for customers who need help.

The callback receiver verifies PawaPay's signed callback headers against PawaPay's public key endpoint, checks the signed request body digest and signature time window, and stores only minimal transaction fields. It does not store phone numbers or raw callback bodies. Duplicate callbacks upsert the same operation and transaction ID. A verified deposit callback also updates the matching quote payment status.

### Setup

1. Deploy `sales-bot/` as a Vercel project (set the Vercel project Root Directory to `sales-bot`). The public website can remain on GitHub Pages.
2. In the existing Supabase project, open its SQL Editor and run both `pawapay-callbacks.sql` and `pawapay-payment-links.sql`.
3. In Vercel Project Settings → Environment Variables, add:
   - `PAWAPAY_ENV` = `sandbox` while testing, or `production` for the approved live account
   - `PAWAPAY_API_TOKEN` = token from that same PawaPay environment
   - `SUPABASE_URL` = the Supabase project URL
   - `SUPABASE_SERVICE_ROLE_KEY` = the Supabase service-role key, marked sensitive
   - `PAYMENT_LINK_ADMIN_TOKEN` = a long random staff-only key; do not reuse the PawaPay token
   - `PAYMENT_BASE_URL` = the production Vercel URL for this checkout, for example `https://your-project.vercel.app`
4. Redeploy the Vercel project.
5. In the matching PawaPay dashboard, enable **signed callbacks** for deposits. Use this URL:

   `https://<your-vercel-project>.vercel.app/api/pawapay-callback`

6. Test the full flow in PawaPay Sandbox first. The receiver returns HTTP 200 only after signature verification and durable storage succeed, so PawaPay can retry temporary failures.

### Customer-entered agreed amount

1. Direct the customer to `/pay` on the Vercel checkout site.
2. The customer enters the quote reference, service, exact agreed amount, and currency.
3. The server verifies that the amount and currency fit an operational PawaPay deposit option, then saves a fixed quote record.
4. The customer reviews that saved amount and continues to PawaPay. They cannot change the amount in the payment session.
5. Match the paid amount and reference to the agreed quote before starting work.

This public form accepts customer-supplied amounts so it does not depend on a fixed price list. It has basic same-origin, honeypot, and per-instance rate-limit checks; keep the form on the SIN AI checkout domain and review unpaid or mismatched references manually.

### Staff-created quote link (fallback)

1. Open `/payment-admin` on the Vercel site.
2. Enter the staff-only key and the approved quote reference, description, amount, and currency.
3. Copy the generated `/payment.html?token=...` URL and send it to the customer.
4. The customer reviews the fixed total, continues to PawaPay, chooses from the enabled options, and confirms the payment with their own mobile money provider.
5. A verified callback updates the status shown on the payment page. You can also confirm the final transaction in the PawaPay dashboard.

Never place the PawaPay token, Supabase service-role key, or staff-only key in GitHub, browser code, or chat. The live site should use the production PawaPay token only after the Sandbox flow has been verified. The existing Google Sheets project tracker is not changed automatically by a payment; project/order tracking remains a separate workflow.

## How To Customize

1. Open the app.
2. Go to `Setup`.
3. Enter the client's business details.
4. Add the client's business background, reply style, and master instruction prompt.
5. Enable or disable internet search for that client's bot.
6. Click `Save Setup`.
7. Test the customer chat.
8. Save serious leads.
9. Export CSV when needed.

## First Sales Use

Use this as the first client-facing product MVP:

"We set up an AI sales bot for your business that answers customer questions, qualifies serious buyers, and pushes them toward booking or payment."

This version is intentionally simple so it can be sold, tested, and adjusted before building WhatsApp/API automation.

## Production Direction

The recommended production setup is:

1. Client-facing website/chat widget.
2. Secure backend API.
3. OpenAI or Gemini API for smart replies and structured lead extraction.
4. Database, Google Sheet, or CRM for saved leads.
5. Alert/notification flow for hot leads and human handoff.

## Generated Asset

- `assets/sales-bot-hero.png` was generated for the website hero section using the built-in image generation tool.
