-- Pricera database schema (Postgres)

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT,
  phone TEXT, -- optional
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  paypal_subscription_id TEXT,
  plan_tier TEXT NOT NULL DEFAULT 'trial', -- trial | standard | premium | premiumplus | vip
  plan_duration_months INTEGER, -- billing term chosen at checkout: 1 | 3 | 6 | 12
  plan_status TEXT NOT NULL DEFAULT 'pending_payment', -- pending_payment | active | past_due | canceled
  trial_expires_at TIMESTAMPTZ, -- set on the one-time trial payment: now() + trial_type's duration
  trial_type TEXT, -- which trial was purchased: 24h | 7d
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tracked_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  nickname TEXT,
  competitor_name TEXT,
  platform TEXT DEFAULT 'auto', -- shopify | woocommerce | amazon | manual | auto
  price_selector TEXT,
  currency_default TEXT DEFAULT 'USD',
  alert_threshold_pct NUMERIC DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_price NUMERIC,
  last_currency TEXT,
  last_in_stock BOOLEAN,
  last_checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES tracked_products(id) ON DELETE CASCADE,
  price NUMERIC,
  currency TEXT DEFAULT 'USD',
  in_stock BOOLEAN,
  scraped_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS alerts_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES tracked_products(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL, -- price_drop | price_increase | back_in_stock | out_of_stock
  old_price NUMERIC,
  new_price NUMERIC,
  channel TEXT DEFAULT 'email',
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS scrape_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES tracked_products(id) ON DELETE CASCADE,
  status TEXT NOT NULL, -- success | failed
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Safe to re-run: adds columns introduced after the initial release for tables
-- that already exist in a deployed database.
ALTER TABLE tracked_products ADD COLUMN IF NOT EXISTS last_currency TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plan_duration_months INTEGER;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_expires_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS trial_type TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS full_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE users ALTER COLUMN plan_status SET DEFAULT 'pending_payment';

CREATE INDEX IF NOT EXISTS idx_products_user ON tracked_products(user_id);
CREATE INDEX IF NOT EXISTS idx_history_product ON price_history(product_id, scraped_at DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_product ON alerts_log(product_id, sent_at DESC);
