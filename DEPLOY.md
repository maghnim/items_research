# Deploying the Pricera demo — 100% free stack

This uses **Neon** (free Postgres, no card required) + **Render** (free web service + free static site) + **Resend** (free email tier) + **Stripe test mode** / **PayPal sandbox** (both free, no live money involved). Total cost: $0.

## 1. Push the code to GitHub

Render deploys from a Git repo, so the code needs to live on GitHub first.

```bash
cd pricepilot
git add .
git commit -m "Initial Pricera scaffold"
```

Then create a new empty repo at https://github.com/new (public or private, your choice), and:

```bash
git remote add origin https://github.com/<your-username>/pricepilot.git
git branch -M main
git push -u origin main
```

## 2. Create a free Postgres database (Neon)

1. Go to https://neon.tech → sign up free (GitHub login works, no card needed).
2. Create a project called `pricepilot`.
3. Copy the connection string it gives you (starts with `postgres://...`) — you'll need it as `DATABASE_URL` in step 3.

## 3. Deploy the backend + frontend (Render Blueprint)

The repo already includes `render.yaml`, so Render can spin up both services in one step.

1. Go to https://render.com → sign up free with GitHub.
2. Click **New → Blueprint**, connect your `pricepilot` GitHub repo. Render reads `render.yaml` and proposes two services: `pricepilot-api` (web service) and `pricepilot-app` (static site).
3. Before the first deploy finishes, open `pricepilot-api` → **Environment** and fill in the secrets that were left blank in `render.yaml`:
   - `DATABASE_URL` → the Neon connection string from step 2
   - `RESEND_API_KEY`, `ALERT_FROM_EMAIL` → from step 4 below
   - `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_*` → from step 5 below
   - `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_PLAN_*` → from step 6 below
4. Trigger a manual deploy once all values are set (Render redeploys automatically on env var changes anyway).
5. The build command (`npm install && npm run migrate`) creates the database tables automatically on every deploy — no separate migration step needed.

Your live URLs will be:
- API: `https://pricepilot-api.onrender.com`
- App: `https://pricepilot-app.onrender.com`

If Render assigns different subdomains (names can be taken), update:
- `frontend/js/api.js` → `PRODUCTION_API_URL`
- `render.yaml` → `APP_URL` / `API_URL` env vars
- commit and push again

> **Free tier note:** Render's free web services spin down after 15 minutes of no traffic and take ~30–60s to wake back up on the next request — expected for a demo, not an issue for showing it off.

## 4. Free transactional email (Resend)

1. Sign up free at https://resend.com (no card required, 100 emails/day free).
2. Create an API key → put it in `RESEND_API_KEY`.
3. For a demo you can use Resend's sandbox sending domain; set `ALERT_FROM_EMAIL=onboarding@resend.dev` so you don't need to verify a custom domain.

## 5. Stripe (test mode — no real charges)

1. Sign up free at https://dashboard.stripe.com/register.
2. Stay in **Test mode** (toggle top-right).
3. Go to **Product catalog → Add product**, create one product with a **one-time** price of **€2.99** — this is the trial unlock. Copy its `price_...` ID into `STRIPE_PRICE_TRIAL`. Without this, signup's checkout step fails for every user.
4. Create 4 more products, each with 4 **recurring** monthly-equivalent EUR prices (1/3/6/12-month billing intervals) for the categories **Standard, Premium, Premium Plus, VIP** — see `backend/.env.example` for exact amounts and the 16 env var names (`STRIPE_PRICE_<CATEGORY>_<MONTHS>`). Copy each price's `price_...` ID into the matching env var.
5. Go to **Developers → API keys**, copy the test **Secret key** into `STRIPE_SECRET_KEY`.
6. Go to **Developers → Webhooks → Add endpoint**, URL = `https://pricepilot-api.onrender.com/api/webhooks/stripe`, events = `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
7. Test card for checkout: `4242 4242 4242 4242`, any future expiry, any CVC.

## 6. PayPal (sandbox — no real charges)

1. Sign up free at https://developer.paypal.com (uses your normal PayPal account or a new one).
2. In the Developer Dashboard, stay in **Sandbox** mode.
3. **Apps & Credentials → Create App** → copy Client ID / Secret into `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`. Leave `PAYPAL_MODE=sandbox`. (No extra config needed for the trial unlock — it uses the PayPal Orders API directly with the client ID/secret, not a Billing Plan.)
4. On the same app, under **Webhooks → Add Webhook**, URL = `https://pricepilot-api-cfl6.onrender.com/api/webhooks/paypal`, subscribed to at least `BILLING.SUBSCRIPTION.ACTIVATED`, `BILLING.SUBSCRIPTION.CANCELLED`, `BILLING.SUBSCRIPTION.SUSPENDED`. Copy the resulting **Webhook ID** into `PAYPAL_WEBHOOK_ID` — the backend rejects unsigned/unverifiable events, so webhook updates silently fail without this.
5. Under **Billing Plans**, create a Product + 16 monthly Plans matching the 4 categories × 4 billing terms above. Copy each Plan ID into the matching `PAYPAL_PLAN_<CATEGORY>_<MONTHS>` env var (see `backend/.env.example`).
6. Sandbox test buyer accounts are auto-generated under **Sandbox → Accounts** — use one of those to test the trial unlock and a subscription end-to-end.

## 7. Smoke test

1. Visit `https://pricepilot-app.onrender.com`, sign up for a trial account.
2. Add a competitor product URL from the dashboard.
3. Check Render logs on `pricepilot-api` — you should see the scheduler pick it up and log a scrape within a few minutes.
4. From `pricing.html`, click a plan → confirm Stripe test checkout redirects and completes with the test card.
5. Confirm the webhook updated `plan_tier` in Neon (you can browse tables via the Neon dashboard's SQL editor).

That's the whole free demo loop — nothing here costs money until you swap Stripe/PayPal to live keys and upgrade Render/Neon plans for real traffic.
