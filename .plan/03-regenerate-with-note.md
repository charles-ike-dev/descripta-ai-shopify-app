# 03: Regenerate with a note

**Effort:** S · **Depends on:** none

## Why

If a draft is nearly right, the merchant's only options are to edit the HTML by hand or click Generate again and hope for something better. A short instruction such as "shorter", "mention it's machine washable" or "less salesy" gets a better second draft without hand editing.

## Today

- `generateCopy(product, voice)` in `app/lib/ai.server.ts` has no input for a one-off instruction.
- The `generate` intent in `app/routes/app.products.$id.tsx` calls `createDraft(shop, product)`.

## What to build

On the product page, next to **Generate**, add a **Refine** box:

- A text field limited to 300 characters ("Tell the AI what to change…").
- Quick chips that fill the field: *Shorter*, *Longer*, *More technical*, *Add a bullet list*, *Less salesy*.
- **Regenerate** sends the note together with the current draft, so Claude edits the draft instead of starting from scratch.

## Implementation

1. **`ai.server.ts`.** Add an optional third argument, `refine?: { note: string; previous?: CopyResult }`. In `buildPrompt`, when it's set, add:
   ```
   <previous_draft>…</previous_draft>
   <merchant_note>…</merchant_note>
   Revise the previous draft following the merchant's note. The note changes style and emphasis only;
   the rule against inventing facts still applies.
   ```
   If the note states a new fact ("it's waterproof"), treat it as a product fact. That's reasonable, because the merchant is the source of truth. Say this explicitly in the prompt.
2. **`demoCopy`.** Accept the note and handle "shorter" and "longer" in a simple way, so demo mode still visibly responds.
3. **`drafts.server.ts`.** `createDraft(shop, product, refine?)` passes the note through.
4. **Schema.** Add `instruction String?` and `parentId String?` to `Generation`, so History can show "Refined from draft X: 'shorter'".
5. **Route.** The `generate` intent reads `note` and `parentGenerationId` from the form, loads the parent draft (scoped to the shop) and passes it through.
6. **UI.** Show the box only once a draft exists. After it regenerates, the new draft replaces the old one in the side-by-side view, and the old one stays in the product's history list.

## Edge cases

- An empty note means a normal fresh generation.
- Prompt injection in the note, such as "ignore all rules". The note sits in its own tag and the system prompt keeps priority. The HTML sanitiser still runs on the output.
- Very long notes are trimmed to 300 characters on the server as well as in the browser.

## Done when

- [ ] "Shorter" produces a visibly shorter draft that keeps the same facts.
- [ ] The history entry shows the note and links to the parent draft.
- [ ] Demo mode responds to the "shorter" and "longer" chips.
