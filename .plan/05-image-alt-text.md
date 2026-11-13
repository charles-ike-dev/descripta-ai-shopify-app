# 05: Alt text for product images

**Effort:** M · **Depends on:** 04 (image fetching and the vision call)

## Why

Most stores leave image alt text empty. Alt text helps image search and screen readers, and some accessibility laws (for example the European Accessibility Act) push stores to add it. The result is easy to see and check, which makes it a good demo feature.

## What to build

1. **Health check.** Add a "Missing alt text (N images)" issue in `app/lib/health.ts`, with a small weight so it doesn't swamp the description score (or show it as a separate badge).
2. **Product page.** An "Image alt text" card listing each image's thumbnail, its current alt text, and a suggested alt text that can be edited. It has **Generate**, **Apply** and **Undo**.
3. **Bulk.** A "Write alt text" action on the products page. It uses the job system if plan 02 has shipped, otherwise the existing browser runner.

## Implementation

1. **Query.** Reuse the `media` field from plan 04, but fetch all images (`first: 20`), not just 3.
2. **AI (`app/lib/ai.server.ts`).** Add `generateAltText(product, images, voice)` with its own Zod schema:
   ```ts
   z.object({ items: z.array(z.object({ mediaId: z.string(), alt: z.string().describe("Under 125 characters") })) })
   ```
   Send all the images in one request, each followed by a text block naming its media id. Prompt rules: describe the image, not the marketing message; don't start with "Image of"; include the product name once; write in the brand voice's language; stay under 125 characters.
   Haiku 4.5 (`claude-haiku-4-5`) is probably enough here at much lower cost. Make the model a constant you can configure (`ALT_TEXT_MODEL`). Haiku 4.5 returns an error if the request includes `output_config.effort`, so don't copy the request options from `generateCopy`. Use the shared Haiku helper (shared decision 5 in the README), with only `output_config.format` set.
3. **Mutation (`app/lib/products.server.ts`).** `productUpdateMedia` is deprecated, so choose between:
   - **(a) `fileUpdate(files: [{ id, alt }])`.** Updates only the images you send, and is the safest option. It needs the **`write_files`** scope (or `write_themes`), which makes every merchant approve the app again. Bundle it with the other scope changes (shared decision 3).
   - **(b) `productSet` with `files: [{ id, alt }]`.** Works with `write_products`, which the app already has. Shopify treats `files` as the product's **complete** media list, so you must send every existing media id, including videos and 3D models, or the ones you leave out are removed from the product. Test this on a dev store before trusting it.

   Recommendation: use (a) if plan 07 or 18 is also shipping, since merchants are re-approving anyway. Otherwise use (b), with a test that a product's media count is the same before and after.
4. **Storage.** Use `Generation` with `kind = "alt_text"` (shared decision 1). `payload` holds `[{ mediaId, alt }]` and `previousPayload` holds the alt text it replaces, so undo, batches and History work the same as for descriptions. No separate table is needed.
5. **Demo mode.** Use the template `"{title}, product photo {n}"`.
6. **Quota.** One alt-text run for a product counts as one `alt_text` unit (plan 08).

## Edge cases

- Products with 20 or more images: limit to the first 20 and say so.
- Purely decorative images (lifestyle shots). Let the model return a short, neutral description. Don't return an empty string, because Shopify treats empty as "missing".
- Video and 3D media have no alt text through this path, so skip them.

## Done when

- [ ] A product with 4 images and no alt text gets 4 sensible suggestions in one call.
- [ ] Apply writes them to Shopify, so they show in the admin's media editor.
- [ ] Undo restores the previous (empty) values.
- [ ] Applying alt text never changes how many media items a product has. This matters most with option (b).
- [ ] The products table shows the missing-alt-text issue and you can filter by it.
