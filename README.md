# Descripta AI

An embedded Shopify app that writes product descriptions and SEO copy with Claude, in the merchant's own brand voice. Merchants review every draft side by side with the current copy, edit it if they want, apply it to the product with one click, and can undo any change.

Built by Charles Ike as a portfolio project.

## Features

- **Catalog health dashboard.** Lists products from the Admin GraphQL API with search and cursor pagination, and flags products with no description, thin copy (under 40 words) or missing SEO fields.
- **AI drafts.** Sends the product's facts (title, type, vendor, tags, options, price, current description) to Claude and gets back a description, SEO title, meta description and selling points. Structured outputs guarantee valid JSON that matches a Zod schema.
- **Brand voice.** Tone, audience, length, language, keywords to include and claims to avoid, stored per shop and applied to every generation.
- **Review before publish.** Current copy and AI draft side by side, a Google-style search preview, live character counts, and an HTML editor.
- **Apply and undo.** Applying calls `productUpdate`. Every draft is saved with the copy it replaced, so a change can be rolled back.
- **Safe HTML.** Generated HTML goes through an allowlist sanitiser before it is shown or saved, so only simple formatting tags reach the store.
- **Demo mode.** With no `ANTHROPIC_API_KEY`, copy comes from a built-in template, so the full flow can be shown for free.
- **Privacy webhooks.** `app/uninstalled` and the mandatory GDPR topics delete all shop data.

## Tech stack

| Area | Choice |
| --- | --- |
| Framework | React Router 7 (Shopify's official app template), TypeScript |
| UI | Polaris web components, App Bridge |
| Shopify APIs | Admin GraphQL API 2026-10, OAuth with session tokens, webhooks |
| AI | Anthropic TypeScript SDK, `claude-opus-5-5`, structured outputs with Zod, server-side refusal fallback |
| Data | Prisma ORM, SQLite in development (PostgreSQL in production) |

## Project layout

```
app/
  lib/
    ai.server.ts         Claude call, prompt, output schema
    copy.ts              Shared types, demo template, HTML sanitiser
    products.server.ts   Admin GraphQL queries and productUpdate mutation
    voice.server.ts      Brand voice and shop data clean-up
  routes/
    app._index.tsx       Products dashboard
    app.products.$id.tsx Draft, edit, apply and undo for one product
    app.voice.tsx        Brand voice settings with live sample
    app.history.tsx      Every draft across the store
    webhooks.*.tsx       Uninstall and privacy webhooks
prisma/schema.prisma     Session, BrandVoice, Generation
shopify.app.toml         Scopes and webhook subscriptions
```

## Run it locally

You need Node.js 22.12 or later and the Shopify CLI (`npm install -g @shopify/cli`).

1. **Create a Shopify Partner account** at https://partners.shopify.com (free).
2. **Create a development store** from the Partner dashboard (Stores, then Add store, then Create development store). Add a few products, or install the free "Simple Sample Data" app.
3. **Install and link the app.**
   ```bash
   npm install
   npm run config:link     # creates the app in your Partner account and fills in client_id
   ```
4. **Add your Claude API key** (optional, the app runs in demo mode without it). Create a key at https://console.anthropic.com, then create a `.env` file:
   ```bash
   ANTHROPIC_API_KEY=sk-ant-...
   ```
5. **Start the dev server.**
   ```bash
   npm run dev
   ```
   The CLI sets up the database, opens a tunnel and prints a preview link. Press `p` to open the app in your dev store and approve the install.

## Deploy

The app is a standard Node server, so it runs on Fly.io, Render, Railway or any Docker host (a `Dockerfile` is included). Vercel also works with the React Router Vercel preset.

1. **Use PostgreSQL in production.** In `prisma/schema.prisma` set `provider = "postgresql"` and `url = env("DATABASE_URL")`. Delete `prisma/migrations`, then run `npx prisma migrate dev --name init` against a Postgres database (Supabase or Neon work well) to create fresh migrations.
2. **Set environment variables** on the host: `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` (from the Partner dashboard), `SHOPIFY_APP_URL` (your public URL), `SCOPES=write_products`, `DATABASE_URL`, `ANTHROPIC_API_KEY`, and `NODE_ENV=production`.
3. **Build and start.**
   ```bash
   npm run build
   npm run setup   # prisma generate and migrate deploy
   npm run start
   ```
4. **Point Shopify at it.** Set `application_url` and the redirect URL in `shopify.app.toml` to your public URL, then run `npm run deploy` to push the config and webhooks.

## What you must do yourself

- Create the Shopify Partner account, development store and app (step 1 to 3 above). These need your login.
- Create an Anthropic API key if you want real AI copy. Each draft costs a few cents with `claude-opus-5-5`.
- Record the demo and take screenshots in your dev store for the portfolio.

## Ideas for next steps

- Bulk mode: select many products and generate drafts in a background job.
- Image understanding: send the product photo to Claude for richer, more accurate copy.
- Translations: write the same copy in several languages using Shopify's Translations API.
- Usage-based billing with the Shopify Billing API.

## Licence

Based on Shopify's MIT-licensed app template (see `LICENSE.md`).

## Screenshots and preview

`docs/screenshots/` has images of the main screens, and `docs/descripta-preview.html` is a clickable preview with sample products that runs in any browser. Replace the screenshots with captures from your own dev store once the app is installed.
