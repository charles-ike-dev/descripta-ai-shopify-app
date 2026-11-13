# 12: Richer product facts (metafields and variants)

**Effort:** S · **Depends on:** none

## Why

The system prompt rightly forbids inventing materials, sizes and certifications. As a result, drafts are vague whenever those facts aren't in the title or tags. Many stores *do* record them, just in places the app doesn't read: metafields (`custom.material`, `custom.care_instructions`), Shopify's standard category metafields, variant SKUs, weights and barcodes. Reading those gives more specific copy at no extra cost.

## Today

`toProductInput` in `app/lib/products.server.ts` passes the title, type, vendor, tags, options, minimum price, image alt text and current description. Nothing else.

## What to build

- Read product metafields and some variant data, and send the useful parts to Claude as extra facts.
- A **"Facts used"** expandable list on the product page, so the merchant can see exactly what the AI was told and trust the result.
- A setting to exclude namespaces (some apps store internal data in metafields).

## Implementation

1. **Query.** Add to `DescriptaProduct`:
   ```graphql
   category { fullName }
   metafields(first: 30) { nodes { namespace key type value definition { name } } }
   variants(first: 20) {
     nodes { title sku barcode inventoryItem { measurement { weight { value unit } } } }
   }
   ```
   Confirmed for API 2026-10: `category` returns a `TaxonomyCategory` with `fullName`. `ProductVariant` no longer has `weight` or `weightUnit`, so weight comes from `inventoryItem.measurement.weight`.
2. **Filtering.** Keep metafields whose type is text, number, boolean, dimension, volume, weight or rating. Drop JSON, references and files. Leave out namespaces that start with `app--` or the shop's excluded list, and values over 500 characters.
3. **Labels.** Use `definition.name` when there is one ("Material"). Otherwise humanise the key (`care_instructions` becomes "Care instructions"). For dimension and weight types, format the JSON value as "12 cm".
4. **`ProductInput`.** Add `category?: string`, `attributes?: { label: string; value: string }[]` and `variantSummary?: string` (for example "S, M, L in Black and Navy; 250 g"). `buildPrompt` adds them to `facts`.
5. **Prompt.** Tell Claude that attributes are verified facts and should be used where relevant.
6. **UI.** On the product page, show `facts` as a definition list. Return it from the loader by building the same object `buildPrompt` uses (move it out into a `productFacts()` function, so the display and the prompt can't drift apart).
7. **Setting.** Add `excludedNamespaces String @default("")` to `ShopSettings` (shared decision 2 in the README).

## Edge cases

- Metafields holding HTML or rich text: strip them to plain text.
- Very large variant lists: summarise them and don't list every one.
- Sensitive internal data (cost price, supplier codes). The namespace filter covers this, and the "Facts used" list makes any leak visible.

## Done when

- [ ] A product with `custom.material = "100% organic cotton"` gets a draft that mentions organic cotton.
- [ ] The "Facts used" list matches what was sent to Claude.
- [ ] Excluding a namespace removes those values from both the list and the prompt.
