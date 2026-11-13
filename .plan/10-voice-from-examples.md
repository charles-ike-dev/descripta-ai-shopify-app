# 10: Brand voice from examples

**Effort:** S · **Depends on:** none

## Why

The brand voice form (tone, audience, length, keywords) is abstract. Merchants struggle to describe their voice, but they can easily point at descriptions they like. Learning the voice from examples gives a better first setup and shows off what the AI can do.

## Today

- `app/routes/app.voice.tsx` has a form with a live sample.
- `BrandVoice` stores `tone` as one of the 5 presets in `TONES` (`app/lib/copy.ts`), plus free-text fields.

## What to build

On the brand voice page, a **"Learn from my best products"** panel:

1. A product picker that uses App Bridge's resource picker (`shopify.resourcePicker({ type: "product", multiple: 3 })`) to choose 2 or 3 products.
2. **Analyse**. Claude reads their descriptions and returns suggested settings with a one-line reason for each.
3. The suggestions fill the form, with the changed fields highlighted. The merchant reviews them and clicks Save as usual. Nothing saves automatically.

## Implementation

1. **Schema.** Add `styleNotes String @default("")` to `BrandVoice`. It holds free-form notes the presets can't capture ("uses second person", "opens with a question", "British spelling", "no exclamation marks"). Add it to `VoiceInput`, `DEFAULT_VOICE` and `getVoice`.
2. **Prompt.** Add `Style notes: ${voice.styleNotes || "none"}` to the `<brand_voice>` block in `buildPrompt`.
3. **AI (`app/lib/ai.server.ts`).** Add `inferVoice(examples: { title: string; descriptionHtml: string }[])` with this Zod schema:
   ```ts
   z.object({
     tone: z.enum(["friendly", "luxury", "playful", "technical", "minimal"]),
     audience: z.string(),
     length: z.enum(["short", "medium", "long"]),
     language: z.string(),
     keywords: z.string(),
     styleNotes: z.string().describe("3 to 6 short, concrete style rules"),
     reasons: z.record(z.string(), z.string()).describe("Why each field was chosen"),
   })
   ```
   Derive the enum values from `TONES` and `LENGTHS` so the lists can't drift apart.
4. **Route.** Add an `infer` intent to the action in `app.voice.tsx`. It fetches each selected product's `descriptionHtml` with `getProduct`, rejects products with fewer than about 40 words ("Pick products with a full description"), calls `inferVoice` and returns the suggestions.
5. **Demo mode.** Return fixed suggestions based on average word count, so the flow can still be shown.
6. **UI.** Add a "Style notes" textarea to the form so the field can also be edited by hand.

## Edge cases

- The examples are inconsistent with each other. Claude should pick the dominant style and say so in `reasons`.
- The examples aren't in English: set `language` to match.
- Picked products with no description: block them before calling the API.

## Done when

- [ ] Picking 3 products with a punchy, short style suggests "playful" or "minimal", "short", and style notes that match.
- [ ] Nothing is saved until the merchant clicks Save.
- [ ] Style notes noticeably change the next generated draft.
