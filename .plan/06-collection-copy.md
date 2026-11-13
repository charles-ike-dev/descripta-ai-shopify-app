# 06: Collection descriptions and SEO

**Effort:** M · **Depends on:** none (reuses the review and apply pieces from 01 if they exist)

## Why

Collection pages often rank better than product pages for broad searches ("linen shirts", "ceramic planters"). Most stores leave them empty or with one line of text. The current product flow (health check, draft, review, apply, undo) carries straight over.

## What to build

- A **Collections** tab in the app nav, with a health table like the products page (no description, thin copy, missing SEO fields).
- A collection detail page with the same side-by-side draft, edit, apply and undo flow.
- The prompt uses the collection's title, its rules (for smart collections) and the titles and types of a sample of its products, so the copy describes what's actually in it.

## Implementation

1. **Generalise the data model.** Apply shared decision 1 from the README if it hasn't been done yet. Collections use `kind = "description"` and `resourceType = "collection"`, and keep using the existing description and SEO columns. Keep `productId` as the resource GID column (or rename it to `resourceId` in the same migration, since several plans now use it for things other than products). Index `[shop, resourceType, productId]`.
2. **Queries (`app/lib/collections.server.ts`).**
   - List: `collections(first, query, sortKey: UPDATED_AT)` with `id title handle descriptionHtml seo { title description } image { url altText } productsCount { count }`.
   - Detail: add `ruleSet { rules { column relation condition } }` and `products(first: 15) { nodes { title productType vendor tags } }`.
   - Update: `collectionUpdate(input: { id, descriptionHtml, seo: { title, description } })`. The existing `write_products` scope covers collections.
3. **AI.** Add a `generateCollectionCopy(collection, voice)` that reuses `CopySchema`. Prompt: describe the range, who it's for and what ties it together. Don't list individual products or prices, because collection contents change.
4. **Health.** `scoreCopy` already accepts any `HealthInput`, so reuse it. Collections might use a lower word target, around 60 to 100 words.
5. **Routes.** `app.collections._index.tsx` and `app.collections.$id.tsx`. Pull shared UI out of `app._index.tsx` (952 lines) and `app.products.$id.tsx` into components under `app/lib/` rather than copying them.
6. **History.** Show the resource type and link to the right page.

## Edge cases

- Empty collections with 0 products: write the copy from the title and rules alone, and warn that the result is generic.
- Very large collections: only the first 15 products are sent, which is enough.

## Done when

- [ ] The Collections tab lists collections with health scores.
- [ ] A draft for "Summer dresses" mentions the actual styles and fabrics from the sample products.
- [ ] Apply and undo work through `collectionUpdate`.
- [ ] Product pages and history still work after the `Generation` migration.
