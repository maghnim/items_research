# Pricera

Automated competitor price tracking SaaS. Users add competitor product URLs; Pricera scrapes them on a schedule, logs price history, and emails an alert the moment a price or stock status changes.

## Structure

```
pricepilot/
  backend/    Node.js + Express API, Postgres, scraping + scheduler + billing
  frontend/   Static HTML/CSS/JS marketing site + dashboard (no build step)
```

## Backend setup

Requires **Node.js 18+** and a **Postgres** database.

```bash
cd backend
cp .env.example .env    # fill in DATABASE_URL, JWT_SECRET, Stripe/PayPal keys, Resend key
npm install
npm run migrate         # creates tables from src/db/schema.sql
npx playwright install chromium   # only needed for JS-rendered fallback scraping
npm run dev              # starts API on http://localhost:4000
```

### Required third-party accounts
- **Postgres** — Railway, Render, Supabase, or a local instance.
- **Stripe** — create 4 recurring Prices (Starter/Growth/Pro/Agency) and a webhook endpoint pointing at `POST /api/webhooks/stripe` subscribed to `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`.
- **PayPal** — create a Product + 4 Billing Plans in the PayPal Developer Dashboard matching the same tiers, and a webhook pointing at `POST /api/webhooks/paypal`.
- **Resend** (or swap for SendGrid in `src/services/mailer.js`) — for alert emails.

## Frontend setup

No build step. Just open `frontend/index.html` in a static server:

```bash
cd frontend
python3 -m http.server 5500
```

`frontend/js/api.js` points at `http://localhost:4000/api` when running on localhost, and `PRODUCTION_API_URL` (top of that file) in production — update that constant to your deployed backend URL.

## Free demo deployment

See [`DEPLOY.md`](./DEPLOY.md) for a step-by-step, $0 deployment using Neon (Postgres) + Render (backend + frontend) + Resend (email) + Stripe test mode + PayPal sandbox. `render.yaml` at the repo root is a ready-to-use Render Blueprint for this.

## Pages included

- Marketing: `index.html`, `pricing.html`, `about.html`, `contact.html`
- Auth: `login.html`, `signup.html`
- App: `dashboard.html`
- Compliance (required by Stripe/PayPal underwriting): `privacy-policy.html`, `terms-of-service.html`, `refund-policy.html`

## Before going live

1. Replace placeholder support/billing/privacy email addresses in the legal pages and `mailer.js` with your real domain's addresses.
2. Set real Stripe Price IDs and PayPal Plan IDs in `.env`.
3. Point DNS + SSL at your host (Railway/Render/VPS) and update `APP_URL`/`API_URL`.
4. Run `npm run migrate` against your production Postgres.
5. Test one full signup → trial → Stripe checkout → webhook → plan upgrade loop in Stripe test mode, and the equivalent in PayPal sandbox, before switching to live keys.
