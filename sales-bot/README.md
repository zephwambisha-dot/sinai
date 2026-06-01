# SIN AI Sales Bot Website

This is the first website version of the SIN AI Sales Bot. It includes a public product page plus the working bot app on the same site.

## What It Does

- Presents the product as a client-facing website.
- Replies to customer messages using a configurable business profile.
- Uses a backend API when running with `npm start`.
- Can use OpenAI or Gemini from the backend when an API key is configured.
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
- `HOT_LEAD_WEBHOOK_URL` sends hot leads to another automation/webhook endpoint.

## How To Customize

1. Open the app.
2. Go to `Setup`.
3. Enter the client's business details.
4. Click `Save Setup`.
5. Test the customer chat.
6. Save serious leads.
7. Export CSV when needed.

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
