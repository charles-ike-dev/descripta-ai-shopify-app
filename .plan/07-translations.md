# 07: Translations

**Effort:** L · **Depends on:** none (benefits from 02 for whole-catalog runs)

## Why

Stores selling across borders with Shopify Markets need copy in each of their languages. Generic machine translation sounds flat and ignores the brand voice. Translating the approved copy in the brand voice is clearly better and is a good reason to upgrade to a paid plan.

## Today

`BrandVoice.language` sets the language the *main* copy is written in. Nothing is written to Shopify's translation layer.

## What to build

- **Product page:** a "Translations" card listing each published shop language and its status (missing, out of date, done). It has **Translate** per language and **Translate all**.
- **Products page:** a bulk "Translate" action.
- **Review:** each language's text is shown before publishing, like the main draft.

## Implementation

1. **Scopes.** Add `read_translations,write_translations,read_locales` to `shopify.app.toml` and the `SCOPES` environment variable. This forces merchants to re-approve the app. Check the exact scope names in the Shopify AI Toolkit.
2. **Queries (`app/lib/translations.server.ts`).**
   - `shopLocales(published: true) { locale name primary }` returns the languages to offer, excluding the primary one.
   - `translatableResource(resourceId: $id) { translatableContent { key value digest locale } translations(locale: $l) { key value outdated } }` gives the source text, its **digest** and any existing translations. The keys needed are `body_html`, `meta_title` and `meta_description`. `title` is optional, behind a setting.
   - `translationsRegister(resourceId, translations: [{ key, locale, value, translatableContentDigest }])` publishes them. The digest must match the current source text, or Shopify rejects the translation.
3. **AI.** Add `translateCopy(source, targetLocale, voice)` with a Zod schema `{ descriptionHtml, seoTitle, seoDescription }`. Prompt: translate and adapt to the local market rather than translating word for word, keep the tone and the HTML structure, keep the SEO length limits, and keep brand names and avoided claims out of the translation as well. Run `sanitizeHtml` on the output.
4. **Schema.**
   ```prisma
   model TranslationDraft {
     id        String   @id @default(cuid())
     shop      String
     resourceId String
     locale    String
     sourceDigest String
     descriptionHtml String
     seoTitle  String
     seoDescription String
     previous  String   // JSON of previous translation values, for undo
     status    String   @default("draft")
     createdAt DateTime @default(now())
     @@index([shop, resourceId, locale])
   }
   ```
   Add it to `deleteShopData`.
5. **Out of date.** If Shopify reports `outdated: true`, or the stored `sourceDigest` differs from the current digest, mark that language as "Out of date" and offer to translate it again.
6. **Undo.** Re-register the previous values. If there was no previous translation, use `translationsRemove`.

## Edge cases

- A shop with only one language: hide the card and explain how to add languages.
- The source changes between drafting and applying, so the digest no longer matches. Fetch the current digest again and ask the merchant to translate again.
- Right-to-left languages (Arabic, Hebrew). Set `dir="rtl"` on the preview so it displays correctly.

## Done when

- [ ] A shop with French and German published gets both translations in one click, and they show on the storefront at `/fr/products/...`.
- [ ] Editing the English description marks both as out of date.
- [ ] Undo restores the previous translations.
