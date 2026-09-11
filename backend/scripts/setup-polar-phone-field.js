// One-off setup script — NOT run as part of the app. Creates a required "Phone number"
// text Custom Field in Polar and attaches it to POLAR_PRODUCT_TRIAL / POLAR_PRODUCT_PLAN,
// so Polar's hosted checkout form requires a phone number for every checkout on those
// products. Safe to re-run: reuses the field if it already exists, and skips a product
// that's already attached instead of duplicating the attachment.
//
// Usage:
//   1. Create backend/.env (copy backend/.env.example) and fill in real values for
//      POLAR_ACCESS_TOKEN, POLAR_MODE, POLAR_PRODUCT_TRIAL, POLAR_PRODUCT_PLAN.
//   2. The access token needs custom_fields:write and products:write scopes — if the
//      token you've been using only has checkouts:write, create a new one with all
//      three scopes in Polar's dashboard (Settings -> Developers -> Access Tokens).
//   3. cd backend && node scripts/setup-polar-phone-field.js

require('dotenv').config();
const { Polar } = require('@polar-sh/sdk');

const polar = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN,
  server: process.env.POLAR_MODE === 'production' ? 'production' : 'sandbox',
});

const FIELD_SLUG = 'phone';

async function findOrCreatePhoneField() {
  const pages = await polar.customFields.list({ query: FIELD_SLUG });
  for await (const page of pages) {
    const existing = page.result.items.find((f) => f.slug === FIELD_SLUG);
    if (existing) {
      console.log(`Reusing existing custom field "${existing.name}" (${existing.id})`);
      return existing;
    }
  }

  const created = await polar.customFields.create({
    type: 'text',
    slug: FIELD_SLUG,
    name: 'Phone number',
    properties: {
      formLabel: 'Phone number',
      formPlaceholder: '+1 555 555 5555',
    },
  });
  console.log(`Created custom field "${created.name}" (${created.id})`);
  return created;
}

async function attachToProduct(productId, fieldId) {
  const product = await polar.products.get({ id: productId });

  if (product.attachedCustomFields.some((f) => f.customFieldId === fieldId)) {
    console.log(`"${product.name}" (${productId}) already has the phone field attached — skipping.`);
    return;
  }

  const attachedCustomFields = [
    ...product.attachedCustomFields.map((f) => ({ customFieldId: f.customFieldId, required: f.required })),
    { customFieldId: fieldId, required: true },
  ];

  await polar.products.update({ id: productId, productUpdate: { attachedCustomFields } });
  console.log(`Attached phone field (required) to "${product.name}" (${productId}).`);
}

async function main() {
  const productIds = [process.env.POLAR_PRODUCT_TRIAL, process.env.POLAR_PRODUCT_PLAN].filter(Boolean);
  if (productIds.length === 0) {
    console.error('Set POLAR_PRODUCT_TRIAL and/or POLAR_PRODUCT_PLAN in backend/.env before running this.');
    process.exit(1);
  }
  if (!process.env.POLAR_ACCESS_TOKEN) {
    console.error('Set POLAR_ACCESS_TOKEN in backend/.env before running this.');
    process.exit(1);
  }

  const field = await findOrCreatePhoneField();
  for (const productId of productIds) {
    await attachToProduct(productId, field.id);
  }
  console.log('Done — Polar checkout will now require a phone number for these products.');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  if (err.body) console.error(err.body);
  process.exit(1);
});
