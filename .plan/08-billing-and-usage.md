# 08: Billing and usage limits

**Effort:** M · **Depends on:** none · **Must ship before** real merchants use the app

## Why

Every draft calls `claude-opus-5-5` and costs real money. With no limits, one shop running bulk mode on a large catalog runs up an uncapped API bill. Billing also turns the portfolio project into something that could earn money, and the Shopify App Store requires apps to charge through the Billing API.

## What to build

| Plan | Price | Drafts per month | Features |
| --- | --- | --- | --- |
| Free | $0 | 10 | Single drafts only |
| Starter | ~$9 / month | 200 | Bulk, image understanding |
| Growth | ~$29 / month | 1,000 | Everything, including translations and auto-drafts |

The numbers are placeholders. Set them once you know the real cost per draft (log `usage` from Anthropic responses first).

- A **Plan** page (`/app/plan`) showing the current plan, usage this month and upgrade buttons.
- A usage meter in the app header or on the products page ("37 of 200 drafts this month").
- Clear blocking when a shop is over its limit: "You've used all 10 free drafts. Upgrade to keep writing."

## Implementation

1. **Measure first.** In `generateCopy`, read `response.usage` (input and output tokens) and store it on `Generation` as `inputTokens Int?` and `outputTokens Int?`. This gives the real cost per draft for setting prices.
2. **Usage table.**
   ```prisma
   model Usage {
     id     String @id @default(cuid())
     shop   String
     period String // "2026-11"
     kind   String // "draft" | "alt_text" | "translation"
     count  Int    @default(0)
     @@unique([shop, period, kind])
   }
   ```
   Increment it with an `upsert` in `createDraft` (and the alt-text and translation equivalents) *after* the call succeeds. Add it to `deleteShopData`.
3. **Billing config.** Choose one approach:
   - **Shopify managed pricing** (set up in the Partner dashboard). Shopify hosts the plan page and you only read the active plan. It's the least code, but supports recurring plans only.
   - **Billing API** using the `billing` option in `shopifyApp()` in `app/shopify.server.ts`, with `billing.require()` and `billing.request()` in loaders. This gives full control and allows usage-based charges later.
   Recommendation: start with managed pricing, and read the active subscription with `currentAppInstallation { activeSubscriptions { name status } }`.
4. **Enforcement (`app/lib/plan.server.ts`).** `assertCanGenerate(shop, kind, n)` runs before every AI call. It's used in `createDraft`, in the bulk/job start (checking the whole batch up front) and in the auto-draft webhook. It throws a typed `QuotaError`, which the UI shows as an upgrade banner.
5. **Feature gates.** `planAllows(plan, "bulk" | "images" | "translations" | "auto")` controls which buttons show, and the server checks it again on every request.
6. **Demo mode.** It's free, so skip quota checks when `isDemoMode()` is true. That keeps local development smooth.
7. **Webhook.** Subscribe to `app_subscriptions/update` so the stored plan stays in sync after upgrades and cancellations.

## Edge cases

- Development stores: Shopify test charges (`test: true`) when the store is a dev store.
- Failed generations must not count against the quota.
- A bulk run that would go over the limit. Offer "Write the first N" rather than failing the whole run.
- The month rolls over mid-run. Use the period of each draft's start time.

## Done when

- [ ] A free shop is blocked at draft 11 and shown an upgrade path.
- [ ] Upgrading on a dev store with a test charge raises the limit straight away.
- [ ] The usage meter matches the number of `Generation` rows this month.
- [ ] Token usage is recorded for every real (non-demo) draft.
