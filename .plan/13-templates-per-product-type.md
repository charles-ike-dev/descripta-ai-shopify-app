# 13: Description templates per product type

**Effort:** M · **Depends on:** none (works well with 12)

## Why

One brand voice for the whole store is too coarse. A clothing store wants "Fit & sizing" and "Care" sections on apparel but not on gift cards. An electronics store wants a specs list on devices but not on cables. Consistent structure within a category looks professional and helps shoppers compare products.

## What to build

- **Templates** page (`/app/templates`). Each template has:
  - A name and a **match rule**: product type equals X, a tag contains Y, or a collection.
  - **Sections**: an ordered list of headings, each with a short instruction ("Fit & sizing: mention fit and model size if known").
  - Optional overrides of the brand voice length and tone.
- When generating, the first matching template (by priority) is applied. The product page shows "Using template: Apparel", with a dropdown to pick a different one.
- A **Default** template that reproduces today's unstructured output.

## Implementation

1. **Schema.**
   ```prisma
   model Template {
     id        String  @id @default(cuid())
     shop      String
     name      String
     priority  Int     @default(0)
     matchType String  // "productType" | "tag" | "collection"
     matchValue String
     sections  String  // JSON: { heading: string; instruction: string }[]
     length    String? // overrides BrandVoice.length
     tone      String?
     @@index([shop, priority])
   }
   ```
   Add it to `deleteShopData`.
2. **Matching (`app/lib/templates.server.ts`).** `pickTemplate(shop, product)`. Product type and tag can be checked from the product alone. Collection matching needs `collections(first: 10) { nodes { id } }` added to the product query.
3. **Prompt.** When a template is used, add a `<structure>` block to `buildPrompt`: "Use these sections in this order, each as an `<h3>` heading followed by content. Skip a section if no facts support it, and don't invent content to fill it." Skipping empty sections is important, because it stops Claude making up sizing information just to fill a heading.
4. **Headings.** `sanitizeHtml` already allows `<h2>`, `<h3>` and `<h4>`, so templates can ask for real `<h3>` headings rather than bold paragraphs. Real headings are better for accessibility and SEO. Update the `descriptionHtml` description in `CopySchema` (which currently lists only `<p>`, `<ul>`, `<li>`, `<strong>` and `<em>`) to allow `<h3>` when a template is in use. Check how a few common themes style `<h3>` inside product descriptions.
5. **Starter templates.** Offer presets to choose from (Apparel, Beauty, Home, Electronics, Food), so merchants don't start from an empty form.
6. **Generation record.** Store `templateId` on `Generation` so History shows which template was used.

## Edge cases

- More than one template matches: the highest priority wins, and the UI shows the order.
- The product type is renamed and the template stops matching. Show "0 products match" on the template list.
- A bulk run mixing product types: each product picks its own template.

## Done when

- [ ] An "Apparel" template with Fit / Fabric / Care sections produces those sections for apparel products only.
- [ ] A section with no supporting facts is left out rather than invented.
- [ ] Changing the template on the product page and regenerating uses the chosen template.
