# 11: Full-catalog scan

**Effort:** M · **Depends on:** none (pairs well with 02)

## Why

`scanProducts` in `app/lib/products.server.ts` scores one page of products: the 250 most recently updated (`SCAN_LIMIT`). A store with 3,000 products never sees health scores for the other 2,750, and those older products are usually the ones with the worst copy. The headline number on the dashboard is therefore misleading for exactly the stores that need the app most.

## What to build

- A stored health snapshot for **every** product, refreshed in the background.
- Dashboard totals ("412 products need work") that cover the whole catalog.
- Filtering and sorting by health score across the whole catalog, with pagination over the stored rows rather than over a live API page.

## Implementation

1. **Bulk operation.** Use `bulkOperationRunQuery` to export every product with `id title status handle updatedAt descriptionHtml seo { title description } featuredMedia { preview { image { url altText } } }`. Shopify runs it in the background and returns a JSONL file URL when it finishes.
2. **Completion.** Subscribe to the `bulk_operations/finish` webhook (in `shopify.app.toml`), or poll `currentBulkOperation`. When it finishes, stream the JSONL download line by line. Don't load it all into memory, because large catalogs can produce files of hundreds of MB.
3. **Schema.**
   ```prisma
   model ProductHealth {
     shop        String
     productId   String
     title       String
     status      String
     imageUrl    String?
     words       Int
     hasSeoTitle Boolean
     hasSeoDesc  Boolean
     score       Int
     issues      String   // JSON array
     updatedAt   DateTime // Shopify's updatedAt
     scannedAt   DateTime @default(now())
     @@id([shop, productId])
     @@index([shop, score])
   }
   model CatalogScan {
     id String @id @default(cuid())
     shop String
     bulkOperationId String
     status String // running | done | failed
     startedAt DateTime @default(now())
     finishedAt DateTime?
   }
   ```
   Add both to `deleteShopData`.
4. **Keeping it fresh.**
   - Subscribe to `products/update` and `products/delete` and upsert or delete one `ProductHealth` row each time. These handlers only *read* the product, so they can't cause a loop with the app's own `productUpdate`.
   - After apply or revert (plan 01), update the row straight away.
   - Run a full rescan nightly (a scheduled task from plan 02), or on demand with a "Rescan catalog" button.
   - Webhook handlers must reply within 5 seconds. A single-row upsert is fast enough. Anything heavier goes on the job queue.
5. **Dashboard.** The loader in `app/routes/app._index.tsx` reads from `ProductHealth`, paginating with `skip`/`take` or a cursor, and using `orderBy: score`. Keep the live `scanProducts` path as a fallback until the first scan finishes ("Scanning your catalog… showing the 250 most recent for now").
6. **Scoring.** Reuse `scoreCopy`. When the brand voice length changes, scores need recalculating. Store `words` (as in the schema above) and re-score with SQL, without refetching anything from Shopify.

## Edge cases

- Since API 2026-01, an app can run up to 5 bulk query operations per shop at the same time. Still allow only one catalog scan per shop (check `CatalogScan` for a running row), so a double-click doesn't start two.
- Webhooks can arrive out of order. Ignore an update older than the stored `updatedAt`.
- Catalogs with 100,000+ products: batch the upserts in transactions of about 500 rows.

## Done when

- [ ] A store with 1,000 products shows the correct health total for all 1,000.
- [ ] Editing a product in the Shopify admin updates its score within a minute.
- [ ] Sorting by "worst first" includes products last updated years ago.
