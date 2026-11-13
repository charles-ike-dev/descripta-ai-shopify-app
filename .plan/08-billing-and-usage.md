# 08: Billing and usage limits

**Effort:** M · **Depends on:** none · **Must ship before** real merchants use the app

## Why

Every draft calls `claude-opus-5-5` and costs real money. With no limits, one shop running bulk mode on a large catalog runs up an uncapped API bill. Billing also turns the portfolio project into something that could earn money, and the Shopify App Store requires apps to charge through Shopify.

## What to build

| Plan | Price | AI units per month | Features |
| --- | --- | --- | --- |
| Free | $0 | 10 | Single drafts only |
| Starter | ~$9 / month | 200 | Bulk, image understanding |
| Growth | ~$29 / month | 1,000 | Everything, including translations and auto-drafts |

The numbers are placeholders. Set them once you know the real cost per draft (step 1).

- A **Plan** page (`/app/plan`) showing the current plan, usage this month and an upgrade button.
- A usage meter in the app header or on the products page ("37 of 200 this month").
- Clear blocking when a shop is over its limit: "You've used all 10 free drafts. Upgrade to keep writing."

### What counts as a unit

Every AI call counts (shared decision 4 in the README):

| Action | Units |
| --- | --- |
| Product or collection draft (01, 03, 06, 09), including its fact check (14) | 1 |
| Alt text for one product's images (05) | 1 |
| One language for one product (07) | 1 |
| FAQs for one product (17) | 1 |
| Brand voice inference (10) | 1 |

Store the `kind` alongside each count, so prices can differ by kind later without a migration.

## Implementation

1. **Measure first.** In `generateCopy` (and the other AI helpers), read `response.usage` (input and output tokens) and store it on `Generation` as `inputTokens Int?` and `outputTokens Int?`. This gives the real cost per unit for setting prices.
2. **Usage table.**
   ```prisma
   model Usage {
     id     String @id @default(cuid())
     shop   String
     period String // "2026-11"
     kind   String // "draft" | "alt_text" | "translation" | "faq" | "voice"
     count  Int    @default(0)
     @@unique([shop, period, kind])
   }
   ```
   Add it to `deleteShopData`.
3. **Billing approach: Shopify App Pricing.** This was called "managed pricing" before. Set the plans up in the Partner Dashboard. Shopify hosts the plan-selection page and handles charges, trials and proration. It supports recurring plans and **usage-based charges** (fixed, graduated or volume meters, up to 5 per plan, billed monthly), so per-unit overage can be added later without changing approach. Check how the app reports usage to a meter before relying on it.
   - **Reading the plan.** Use the **Partner API** `activeSubscription(appId:, shopId:)` (this needs a Partner API token, stored as a server-side environment variable). Read the plan when the merchant comes back from Shopify's plan page (the redirect URL parameters say what they picked), and cache it in `ShopSettings` as `plan` and `planCheckedAt`. Refresh it when the cached value is more than about an hour old, and nightly with a scheduled task (plan 02).
   - **No webhook.** Since 28 April 2026, `app_subscriptions/update` is no longer sent to apps that use Shopify App Pricing, so don't subscribe to it. The Partner API read and the redirect cover upgrades. The nightly refresh catches cancellations and failed payments.
   - **Alternative: the Billing API** (`appSubscriptionCreate`, the `billing` option in `shopifyApp()` in `app/shopify.server.ts`). Use it only if App Pricing can't express a pricing model you need. It's more code, and you own the plan page.
4. **Enforcement (`app/lib/plan.server.ts`).** Before every AI call, reserve the unit atomically, then release it if the call fails:
   - **Reserve:** `updateMany({ where: { shop, period, kind, count: { lt: limit } }, data: { count: { increment: 1 } } })`. If it changes 0 rows, the shop is over its limit, so throw a typed `QuotaError`, which the UI shows as an upgrade banner. Create the row with an `upsert` on the first use of the month. Because the limit check and the increment are one statement, two drafts running at once can't both slip past the limit.
   - **Release:** if the AI call fails, decrement the count again, so failed generations don't use up the quota.
   - **Bulk runs and jobs (plan 02):** before starting, check `remaining ≥ selected` and offer "Write the first N" if it isn't. Each item still reserves its own unit when it runs, so the limit holds even if another run starts at the same time.
   - Used in `createDraft`, the other AI helpers, and the auto-draft webhook (plan 09). Limits apply across all kinds combined (`sum(count) for the period`), unless a plan says otherwise.
5. **Feature gates.** `planAllows(plan, "bulk" | "images" | "translations" | "auto")` controls which buttons show, and the server checks it again on every request.
6. **Demo mode.** It's free, so skip quota checks when `isDemoMode()` is true. That keeps local development smooth.

## Edge cases

- Development stores: App Pricing gives free test subscriptions on dev stores, so check the upgrade flow on one.
- Failed generations are released (step 4), so they don't count against the quota.
- The month rolls over mid-run. Use the period of each item's start time.
- The Partner API is unreachable. Keep using the cached plan rather than blocking the merchant, and log the error.

## Done when

- [ ] A free shop is blocked at unit 11 and shown an upgrade path.
- [ ] Upgrading on a dev store raises the limit as soon as the merchant comes back to the app.
- [ ] Two bulk runs started at the same moment never go past the limit together.
- [ ] A failed draft doesn't use up a unit.
- [ ] Token usage is recorded for every real (non-demo) AI call.
- [ ] Unit tests cover reserving, releasing and the over-limit case.
