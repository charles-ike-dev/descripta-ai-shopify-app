# Descripta AI: feature plans

One file per feature. Each plan covers why it matters, what exists today, what to build, the files to touch, and how to know it's done.

## Build order

| # | Feature | Effort | Depends on |
| --- | --- | --- | --- |
| [01](01-bulk-apply.md) | Bulk review and apply | M | none |
| [02](02-server-side-jobs.md) | Server-side bulk jobs | L | none |
| [03](03-regenerate-with-note.md) | Regenerate with a note | S | none |
| [04](04-image-understanding.md) | Image understanding | S | none |
| [05](05-image-alt-text.md) | Alt text for product images | M | 04 |
| [06](06-collection-copy.md) | Collection descriptions and SEO | M | none (easier after 01) |
| [07](07-translations.md) | Translations | L | none |
| [08](08-billing-and-usage.md) | Billing and usage limits | M | none (do before launch) |
| [09](09-auto-draft-new-products.md) | Auto-drafts for new products | M | 02, 08 (14 for auto-publish) |
| [10](10-voice-from-examples.md) | Brand voice from examples | S | none |
| [11](11-full-catalog-scan.md) | Full-catalog scan | M | none (pairs with 02) |
| [12](12-facts-from-metafields.md) | Richer product facts (metafields and variants) | S | none |
| [13](13-templates-per-product-type.md) | Description templates per product type | M | none (better with 12) |
| [14](14-fact-check-guardrail.md) | Fact check before publishing | M | none (better with 12) |
| [15](15-duplicate-copy-detection.md) | Duplicate and boilerplate copy detection | M | 11 |
| [16](16-admin-extension.md) | Write copy from the Shopify product page | M | none (uses 01 helpers) |
| [17](17-faq-and-structured-data.md) | Product FAQs with rich results | L | none (better with 12) |
| [18](18-impact-tracking.md) | Impact tracking (before and after) | L | 02, 08 |
| [19](19-csv-export-import.md) | CSV export and import of drafts | S | none (best with 01) |

Effort: S is about a day or less, M is a few days, L is a week or more.

Suggested path: **01 + 03** finish the current flow. **04 + 05** share the image work and stand out in a demo. **08** must ship before real merchants use the app.

From the second batch: **12 + 14** make the copy more accurate and more trustworthy, and are cheap. **11** fixes the 250-product limit, which matters for any large store. **16** is the best-looking demo.

### By theme

- **Copy quality:** 03, 04, 10, 12, 13, 14
- **Scale:** 01, 02, 09, 11, 19
- **Coverage (more than descriptions):** 05, 06, 07, 17
- **SEO health:** 11, 15, 17
- **Business:** 08, 18
- **Where merchants work:** 16

## Shared decisions

These apply across plans. Whichever plan ships first does the groundwork, and the others build on it.

1. **One change log.** Every AI change (descriptions, alt text, translations, FAQs, collections) is a row in `Generation`, so undo, History, batches (01) and the review queue all work the same way. The first of 05, 06, 07 or 17 to ship adds:
   ```prisma
   kind            String  @default("description") // description | alt_text | translation | faq
   resourceType    String  @default("product")     // product | collection
   locale          String?                         // translations only
   payload         String?                         // JSON of the new values, for kinds other than description
   previousPayload String?                         // JSON of the values it replaced, for undo
   ```
   The existing description and SEO columns stay as they are. No plan creates its own separate draft table.
2. **One settings model.** Per-shop switches live in a new `ShopSettings` model (`shop @unique`), not on `BrandVoice`. That covers `useImages` (04), `autoDraft` (09), `excludedNamespaces` (12) and `blockApplyOnFlags` (14). The first of those plans to ship creates it and adds it to `deleteShopData`.
3. **Ask for new permissions once.** Each new access scope makes every merchant approve the app again, so bundle them into a single release:

   | Plan | Scopes | Also needs |
   | --- | --- | --- |
   | 05 (only if it uses `fileUpdate`) | `write_files` | none |
   | 07 | `read_translations`, `write_translations`, `read_locales` | none |
   | 18 | `read_reports` and/or `read_orders` | Protected customer data approval in the Partner Dashboard |
4. **Every AI call counts towards the quota (08).** That includes alt text (05), collections (06), translations (07), voice inference (10), fact checks (14) and FAQs (17), not just product drafts.
5. **Cheaper model calls.** Plans 05 and 14 use Claude Haiku 4.5 (`claude-haiku-4-5`). Haiku 4.5 rejects `output_config.effort`, and the `fallbacks` setting isn't needed for it. Add a small separate helper for Haiku calls rather than copying the request options from `generateCopy`.
6. **Tests.** Each plan adds unit tests (Vitest) for its pure functions: prompt builders, parsers, scoring and matching. The "Done when" lists cover manual checks only.

## Housekeeping (no plan file needed)

- Add Vitest and unit-test the existing pure functions: `scoreCopy` in `app/lib/health.ts`, `sanitizeHtml` and `demoCopy` in `app/lib/copy.ts`, and `buildPrompt` in `app/lib/ai.server.ts`.
- Update the "Ideas for next steps" section of the root `README.md`, because bulk mode has shipped.
- Every new Prisma model that stores shop data must also be cleared in `deleteShopData` (`app/lib/voice.server.ts`) so the uninstall and GDPR webhooks stay correct.
- The Shopify API details in these plans were checked against shopify.dev (API version 2026-10) in November 2026. Points that are still uncertain are marked "check". Confirm those with the Shopify AI Toolkit before building.
