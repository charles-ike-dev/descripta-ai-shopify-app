# 09: Auto-drafts for new products

**Effort:** M · **Depends on:** 02 (server jobs), 08 (quota). Works best with 01 (review queue).

## Why

The app only helps when the merchant remembers to open it. If new products are drafted automatically, the merchant just finds the drafts in the review queue. The app keeps delivering value without them having to come back, which also helps keep paying customers.

## What to build

- **Setting** on the brand voice page (or a new Settings page): "Automatically write a draft when a product is created", with the options **Off**, **Draft only** (default when on) and **Draft and publish**.
- When a product is created, a draft is queued. The merchant sees it in the review queue (plan 01) with an "Auto" badge.
- **Draft and publish** applies it straight away, but only if the product has no description. It never overwrites copy the merchant wrote.

## Implementation

1. **Webhook subscription** in `shopify.app.toml`:
   ```toml
   [[webhooks.subscriptions]]
   uri = "/webhooks/products/create"
   topics = [ "products/create" ]
   ```
   `write_products` already covers this. Run `npm run deploy` to register it.
2. **Handler (`app/routes/webhooks.products.create.tsx`).**
   - Call `authenticate.webhook(request)` to get `shop` and `payload`.
   - Read the shop's setting. If it's Off, return 200.
   - Call `assertCanGenerate` (plan 08). If the shop is over its quota, skip and record a notice the merchant sees later ("3 new products weren't drafted, upgrade to continue").
   - **Enqueue only.** Create a one-item `Job` (plan 02) with `kind = "draft"` and `source = "auto"`, then return 200 straight away. Never call Claude inside the webhook, because Shopify expects a response within about 5 seconds.
3. **Delay.** Merchants often create a product and then add images and tags over the next few minutes. Add `runAfter DateTime?` to `JobItem` and set it to now plus 10 minutes, so the draft uses the finished product.
4. **Duplicates.** Shopify can deliver a webhook more than once. Add a unique constraint on `(shop, resourceId, source)` for open auto-jobs, or check for an existing queued item first.
5. **Schema.** Add `autoDraft String @default("off")` to `BrandVoice` (or a new `ShopSettings` model if settings grow). Add `source String @default("manual")` to `Generation`.
6. **Publish mode.** After the draft is written, if the setting is `publish` and the product's `descriptionHtml` is still empty, call `applyDraft` (plan 01).

## Edge cases

- Products created by CSV import or a sync app (hundreds at once). Each becomes a queued item, and quota and concurrency limits protect cost. Consider a per-hour cap for each shop.
- A product deleted within the 10-minute delay: the item fails cleanly with "Product not found".
- Don't subscribe to `products/update`. The app's own `productUpdate` would trigger it again, causing a loop.

## Done when

- [ ] With the setting on, creating a product in the admin produces a draft in the review queue within about 11 minutes.
- [ ] Delivering the same webhook twice produces one draft.
- [ ] "Draft and publish" fills in empty descriptions but leaves written ones alone.
- [ ] A shop over its quota gets a notice, not a draft and not an error.
