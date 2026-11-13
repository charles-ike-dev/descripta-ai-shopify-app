# 18: Impact tracking (before and after)

**Effort:** L · **Depends on:** 02 (nightly metrics job), 08 (it's the strongest argument for upgrading)

## Why

Merchants pay for results, not for words. "Products you rewrote sold 14% more in the 30 days after" is the line that keeps a subscription going. Without numbers, the app is a nice-to-have.

## What Shopify actually provides

This decides what can be built, so it comes first. Checked against shopify.dev, API 2026-10:

| Metric | Per product? | Source | Requirements |
| --- | --- | --- | --- |
| Orders, units sold, net sales | Yes | ShopifyQL `FROM sales`, grouped by `product_id` | `read_reports` and **Level 2** protected customer data approval |
| Orders, units sold, revenue | Yes | Admin `orders` query, counting line items | `read_orders` and **Level 1** protected customer data approval |
| Product views, add-to-cart | **No**, only shop-wide totals | ShopifyQL `sessions` | `read_reports` and Level 2 |
| Product views, add-to-cart | Yes | Our own **Web Pixel** extension | Pixel extension and a privacy review |

The protected-customer-data approval is requested in the Partner Dashboard. Without it, the API still answers HTTP 200, but the protected fields come back `null` with errors attached.

## What to build

Ship it in two phases.

**Phase 1: sales impact.** Uses only what Shopify reports.
- On the product page, for each applied draft: **orders, units sold and revenue** for the N days before and after applying (N = 14 or 30).
- An **Impact** page (`/app/impact`) summing up every applied draft. For example, "38 products rewritten · units sold +14% · revenue +$2,310 vs the store overall", plus a table of the biggest gains and losses.
- An honest caveat in the UI: this is a before/after comparison, not a controlled test. Seasonality and promotions affect it.

**Phase 2: views and conversion rate.** Only if phase 1 shows merchants care.
- A Web Pixel extension that counts `product_viewed` and `product_added_to_cart` per product and sends daily totals to the app. That adds views, add-to-cart rate and conversion rate to the same screens.

## Implementation

1. **Choose the sales source.**
   - **(a) `orders` query** with `read_orders` (Level 1 approval). Count `lineItems.product.id` and quantities for orders in the window. It needs only the lower protection level, and the app never reads customer fields.
   - **(b) ShopifyQL** `FROM sales SHOW orders, quantity_ordered, net_sales GROUP BY product_id SINCE … UNTIL …` with `read_reports` (Level 2 approval). This is much less code, and returns refunds and net figures already worked out, but needs the stricter approval.

   Recommendation: start with (a), because Level 1 approval is easier to get and the app only needs product ids and quantities. Move to (b) if the order paging becomes slow for big stores.
2. **Daily table.**
   ```prisma
   model ProductMetricDaily {
     shop      String
     productId String
     date      DateTime // UTC day
     orders    Int      @default(0)
     units     Int      @default(0)
     revenue   Decimal  @default(0)
     views     Int?     // phase 2 (pixel)
     addToCart Int?     // phase 2 (pixel)
     @@id([shop, productId, date])
   }
   ```
   Add it to `deleteShopData`. It holds only per-product totals, with no customer data, but check the GDPR handlers anyway.
3. **Nightly job.** Add a scheduled task (plan 02) that fills in yesterday's totals for every product with an applied draft. The first time a product gets a draft applied, backfill its 30 days before.
4. **Comparison.** Equal-length windows before and after `appliedAt`, excluding the day it was applied. Show "Collecting data, ready in N days" until the after-window is complete. Mark products with fewer than about 10 orders across both windows as "Not enough sales".
5. **Control.** Compare the change for rewritten products with the change in **store-wide** sales over the same windows, which roughly cancels store-wide swings (sales, seasons). Show both numbers.
6. **Scopes.** `read_orders` for option (a), or `read_reports` for (b), plus the approval request. Bundle them into the shared permission release (shared decision 3 in the README).
7. **Phase 2 pixel.** `npm run shopify app generate extension -- --template web_pixel`. Subscribe to `product_viewed` and `product_added_to_cart`, send only `{ productId, event, day }` (no customer identifiers), and add the counts up on the server. Pixels count as tracking, so they must respect the shop's customer privacy and consent settings. Check what that requires before building.

## Edge cases

- A product reverted inside the after-window: end its window at the revert.
- More than one draft applied over time: each one gets its own window, and they can overlap. Show the newest by default.
- New stores, or stores with very few orders: hide the dashboard until there's enough data rather than showing percentages built on 2 orders.
- Refunds: option (b) handles them through net sales. With option (a), count `refundableQuantity` or subtract refunded line items.

## Done when

- [ ] An applied draft from 30 or more days ago shows before and after units sold that match Shopify Analytics for the same dates.
- [ ] The Impact page shows the store-wide comparison next to the totals.
- [ ] Products with too few sales are labelled, not shown with misleading percentages.
- [ ] The app requests only the scope for the sales source it actually uses.
- [ ] Unit tests cover the window maths, including a revert inside the after-window.
