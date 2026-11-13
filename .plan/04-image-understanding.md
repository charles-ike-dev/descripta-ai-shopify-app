# 04: Image understanding

**Effort:** S · **Depends on:** none · **Unblocks:** 05

## Why

Many products have a thin or empty description, and the photo is the best source of facts: colour, shape, style, what's included. Today Claude sees only the image's alt text, which is usually empty.

## Today

- `PRODUCT_ROW_FIELDS` in `app/lib/products.server.ts` fetches `featuredMedia { preview { image { url(transform: { maxWidth: 120 }) altText } } }`. This is a thumbnail for the table.
- `toProductInput` passes only `imageAlt` through.
- `buildPrompt` sends text only.

## What to build

Send up to 3 product images to Claude alongside the facts, with a per-shop setting to turn this off.

## Implementation

1. **Query.** In the `DescriptaProduct` query (the detail query only, not the list), add:
   ```graphql
   media(first: 3, query: "media_type:IMAGE") {
     nodes { ... on MediaImage { id alt image { url(transform: { maxWidth: 1024 }) } } }
   }
   ```
   Add `images: { id: string; url: string; alt: string | null }[]` to `ProductDetail`. Check the `media` query argument against the API docs. If it's not supported, filter on `mediaContentType` in code.
2. **`ProductInput`.** Add `imageUrls?: string[]` in `app/lib/copy.ts`, and fill it in `toProductInput`.
3. **`generateCopy`.** Build the user message as a content array: one `{ type: "image", source: { type: "url", url } }` block per image, then the text prompt. Shopify CDN URLs are public, so URL sources work without downloading them first.
4. **Prompt.** Add to `SYSTEM_PROMPT`: *"Product photos may be attached. Describe only what is clearly visible, such as colour, shape, style and what's included. Do not infer materials, sizes or certifications from a photo. If a photo conflicts with the written facts, trust the facts."*
5. **Setting.** Add `useImages Boolean @default(true)` to `BrandVoice`, with a checkbox in `app/routes/app.voice.tsx`. `getVoice` and `VoiceInput` carry it.
6. **Cost.** A 1024×1024 image is roughly 1,400 input tokens. Three images add a few cents per draft with Opus. Mention this next to the setting.

## Edge cases

- Products with no images: send text only.
- Image URLs that fail to load on Anthropic's side. Catch that error and retry once with text only, so the draft still succeeds.
- Demo mode ignores images.

## Done when

- [ ] For a product with an empty description, a title like "Mug" and a photo of a blue speckled mug, the draft mentions the blue speckled finish.
- [ ] Turning the setting off sends no image blocks (check the request in a debug log).
- [ ] Products without images still generate normally.
