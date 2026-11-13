# 01: Bulk review and apply

**Effort:** M · **Depends on:** none

## Why

Bulk mode can write 25 drafts in one go, but the merchant still has to open each product and click Apply. The writing is fast and the publishing is slow, so the bulk feature is only half useful.

## Today

- Drafts are `Generation` rows with `status = "draft"`.
- Applying only happens per product, in the `apply` intent of `app/routes/app.products.$id.tsx`. That intent calls `updateProductCopy` and sets `status = "applied"`.
- Undo (`revert`) is also per draft.

## What to build

A **Review queue** page (`/app/review`) that:

1. Lists the newest unapplied draft for each product. Each row shows the product image and title, the current and new descriptions (collapsed, expandable), the new SEO title and meta description, and the word count change.
2. Lets the merchant tick drafts and click **Apply selected**, or **Discard selected**.
3. Applies them on the server with a concurrency of 2 and reports per-row success or failure.
4. Groups everything applied in one go under a `batchId`, so the History page can offer **Undo this batch**.
5. Shows a count badge in the app nav ("Review (12)").

## Implementation

1. **Schema.** Add `batchId String?` to `Generation` with `@@index([shop, batchId])`. Add `"discarded"` as a status value.
2. **Shared apply logic.** Move the apply and revert bodies out of `app.products.$id.tsx` into `app/lib/drafts.server.ts` as `applyDraft(admin, shop, generationId, edits?, batchId?)` and `revertDraft(admin, shop, generationId)`. The product page and the review page both call these.
3. **Stale-draft check.** In `applyDraft`, load the product and compare its current `descriptionHtml` with the draft's `previousHtml`. Both values were read from Shopify, so the comparison is fair. If they differ, someone edited the product after the draft was written. Return a `stale` result rather than overwriting their edit. The single-product page can offer "Apply anyway".
4. **Store the HTML as Shopify saved it.** Shopify reformats description HTML when it saves it (spacing, entities, tag forms). Add `descriptionHtml` to the `product { … }` selection of the `DescriptaUpdateProduct` mutation in `updateProductCopy`, and store the returned value in a new `appliedHtml String?` column. The undo check compares against `appliedHtml`, never against the HTML the app sent.
5. **Route `app/routes/app.review.tsx`.**
   - The loader queries drafts with `status = "draft"` and keeps the newest per `productId`.
   - The action handles the `apply`, `discard` and `undoBatch` intents. It takes a list of ids, generates a `batchId` with `crypto.randomUUID()`, runs `applyDraft` for each (2 at a time), and returns `{ id, ok, error?, stale? }[]`.
   - Cap a single request at about 50 drafts so it finishes within a normal request timeout. For larger batches, use the job system in plan 02.
6. **Nav.** Add the link in `app/routes/app.tsx`. The badge count comes from a cheap `count` in the layout loader.
7. **History.** In `app/routes/app.history.tsx`, group rows by `batchId` and add an "Undo batch" action that calls `revertDraft` for each row in the batch.
8. **Products page.** When a bulk run finishes, the toast in `app/lib/bulk.tsx` should link to `/app/review`.

## Edge cases

- The product was deleted after the draft was written. Mark the row as failed with "Product no longer exists" and keep going.
- Older drafts for the same product. Only the newest shows in the queue. Older ones stay visible in History.
- Partial failure. Rows that failed stay selected so the merchant can retry them.
- Undoing a batch where one product has since been edited by hand. Compare the current description with `appliedHtml` (step 4), and skip that product with a warning if they differ.

## Done when

- [ ] Writing 10 drafts in bulk, then applying all 10 from the review page, updates all 10 products in Shopify.
- [ ] A product edited by hand after drafting is flagged as stale, not overwritten.
- [ ] "Undo batch" restores all 10 products' previous copy and flags none of them as edited (proving the `appliedHtml` comparison works).
- [ ] The product page still applies and reverts single drafts through the shared helpers.
