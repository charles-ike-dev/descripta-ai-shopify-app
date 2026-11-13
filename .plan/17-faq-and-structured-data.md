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

1. **Metafield definition.** On install (or on first use), create a definition with `metafieldDefinitionCreate`: owner `PRODUCT`, namespace `$app:descripta`, key `faq`, type `json`, with storefront access set to `PUBLIC_READ` so Liquid can read it. Check the app-reserved namespace syntax and the access options in the Shopify AI Toolkit.
2. **AI.** `generateFaq(product, voice)` with a Zod schema `{ items: { question: string; answer: string }[] }`. Prompt rules: only questions the facts can answer, with no invented policies (shipping, returns) unless they're given; answers of 1 to 3 sentences in the brand voice and language; no duplicates of what the description already says word for word.
3. **Write.** `metafieldsSet` with the JSON value. Keep the previous value on a new `FaqDraft` model (shop, productId, items, previous, status) for undo. Add it to `deleteShopData`.
4. **Theme extension.** `npm run shopify app generate extension -- --template theme_app_extension`. In `blocks/faq.liquid`, read `product.metafields['app--<app-id>--descripta'].faq.value` (check the exact key) and render `<details>/<summary>` items. Add a `<script type="application/ld+json">` block with `FAQPage` markup. Give the block settings for the heading text and whether to start expanded.
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
