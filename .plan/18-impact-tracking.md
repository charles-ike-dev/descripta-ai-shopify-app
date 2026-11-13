# 18: Impact tracking (before and after)

**Effort:** L · **Depends on:** 02 (nightly metrics job), 08 (it's the strongest argument for upgrading)

## Why

Merchants pay for results, not for words. "Products you rewrote got 23% more views and 11% more orders in the 30 days after" is the line that keeps a subscription going. Without numbers, the app is a nice-to-have.

## What to build

- On the product page, for each applied draft: **views, add-to-cart rate, orders and conversion rate** for the N days before and after applying (N = 14 or 30, depending on data available).
- An **Impact** dashboard (`/app/impact`) summing up every applied draft. For example, "38 products rewritten · views +18% · conversion +0.6 pts", and a table of the biggest gains and losses.
- An honest caveat in the UI: this is a before/after comparison, not a controlled test. Seasonality and promotions affect it.

## Implementation

1. **Data source.** Shopify analytics through **ShopifyQL** (the `shopifyqlQuery` Admin API field, which needs `read_reports`). Check that the API is available in 2027-01, and which tables and metrics it offers (sessions, product views, add-to-cart, orders by `product_id`). If ShopifyQL isn't available:
   - **Orders**: use the `orders` query (`read_orders` scope), filtered by `created_at` and counted per product from line items. This is reliable but doesn't include views.
   - **Views**: use a Web Pixel extension that listens for `product_viewed` and `product_added_to_cart` and sends counts to the app's backend. This needs more work and a privacy review.
2. **Snapshots.** When a draft is applied, record `appliedAt` (it already exists). A nightly job (plan 02) fills in a `ProductMetricDaily` table (shop, productId, date, views, addToCart, orders, revenue) for every product with an applied draft, covering 30 days before and after.
3. **Comparison.** Equal-length windows before and after `appliedAt`, excluding the day it was applied. Show "Collecting data, ready in N days" until the after-window is complete. Mark products with fewer than about 50 views as "Not enough traffic".
4. **Control.** Compare the change for rewritten products with the change for **non-rewritten** products in the same window, which roughly cancels store-wide swings (sales, seasons). Show both numbers.
5. **Schema.** `ProductMetricDaily` with `@@id([shop, productId, date])`. Add it to `deleteShopData`. Order data is shop data, not customer personal data, but check the GDPR handlers anyway.
6. **Scopes.** `read_reports` (and `read_orders` for the fallback). Both trigger re-approval, and Shopify reviews `read_orders` more strictly. Ask only for what you use.

## Edge cases

- A product reverted inside the after-window: end its window at the revert.
- More than one draft applied over time: each one gets its own window, and they can overlap. Show the newest by default.
- New stores with no history: hide the dashboard until there's enough data.

## Done when

- [ ] An applied draft from 30 or more days ago shows before and after numbers that match Shopify Analytics for the same dates.
- [ ] The dashboard shows the store-wide control comparison next to the totals.
- [ ] Products with little traffic are labelled, not shown with misleading percentages.
