# 17: Product FAQs with rich results

**Effort:** L · **Depends on:** none (better with 12)

## Why

FAQs answer the questions that stop people buying ("Does it run small?", "Is it dishwasher safe?"), and they add useful, specific text to the page. Stored as structured data, they can also show up in search results and AI answer engines. This is the first feature that puts something on the **storefront** rather than only in the admin.

## What to build

- On the product page, an **FAQ** card. **Generate FAQs** writes 3 to 6 question-and-answer pairs from the product facts. The merchant edits them, reorders them, deletes some and applies.
- FAQs are saved to a product **metafield**, so they belong to the store's data and are not locked inside the app's database.
- A **theme app extension** with an "FAQ" app block that merchants add to their product template in the theme editor. It renders an accessible accordion and outputs `FAQPage` JSON-LD.
- Bulk generation through the job system (plan 02).

## Implementation

1. **Metafield definition, declared in `shopify.app.toml`.** Shopify recommends declaring fixed definitions like this in the TOML file over calling `metafieldDefinitionCreate` at install. `npm run deploy` then applies it to every shop, with nothing to run per install:
   ```toml
   [product.metafields.app.faq]
   type = "json"
   name = "FAQ"
   description = "Questions and answers written by Descripta AI"
   access.admin = "merchant_read"        # merchants see it; edits go through the app so undo stays correct
   access.storefront = "public_read"
   ```
   - This uses the bare **`$app`** namespace. The TOML file doesn't support `$app:sub` namespaces such as `$app:descripta`, so don't use those.
   - In GraphQL, write with namespace `"$app"` and key `"faq"`.
   - Definitions declared in TOML can't be changed through the Admin API, and each deploy can make at most 25 definition changes.
   - `access.storefront` only controls the Storefront API. Liquid can read the metafield either way, but `public_read` keeps a headless storefront option open.
2. **AI.** `generateFaq(product, voice)` with a Zod schema `{ items: { question: string; answer: string }[] }`. Prompt rules: only questions the facts can answer, with no invented policies (shipping, returns) unless they're given; answers of 1 to 3 sentences in the brand voice and language; no duplicates of what the description already says word for word.
3. **Write.** `metafieldsSet(metafields: [{ ownerId, namespace: "$app", key: "faq", type: "json", value }])`. Store the draft as a `Generation` row with `kind = "faq"` (shared decision 1): `payload` holds the new items and `previousPayload` holds the old value, or `null` if there was none. Undo writes the previous value back, or calls `metafieldsDelete` when there was none. Each FAQ generation counts as one `faq` unit (plan 08).
4. **Theme extension.** `npm run shopify app generate extension -- --template theme_app_extension`. In `blocks/faq.liquid`, read the metafield and render `<details>/<summary>` items. For the bare `$app` namespace, the Liquid form is reported to be `product.metafields["$app"].faq.value`, but the docs don't confirm it. Check it on a dev store after the first deploy, and fall back to the resolved form `product.metafields["app--<app-id>"].faq.value` if needed. Write down whichever works in the block's code comments. Add a `<script type="application/ld+json">` block with `FAQPage` markup. Give the block settings for the heading text and whether to start expanded.
5. **Sanitising.** Answers are plain text. Liquid's `escape` filter is used when rendering, and `json` is used for the JSON-LD.
6. **Health.** An optional "No FAQ" issue, off by default, so it doesn't lower the score for merchants who don't use FAQs.

## Edge cases

- The theme already has an FAQ section driven by other metafields. The block is optional, so nothing renders unless the merchant adds it.
- Google currently limits FAQ rich results mostly to authoritative sites. Present it as better on-page content plus structured data, without promising rich results.
- Products with too few facts: return fewer questions, or none, rather than padding.

## Done when

- [ ] Generating and applying FAQs for a product stores them in the metafield (visible in the admin's metafields section).
- [ ] Adding the app block in the theme editor shows a working accordion on the storefront.
- [ ] The page's JSON-LD passes Google's Rich Results Test as valid `FAQPage`.
- [ ] Undo restores the previous FAQ value (or removes it).
