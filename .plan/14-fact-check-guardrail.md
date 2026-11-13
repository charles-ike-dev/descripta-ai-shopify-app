# 14: Fact check before publishing

**Effort:** M · **Depends on:** none (stronger with 12)

## Why

The system prompt tells Claude not to invent facts, but a prompt instruction gives no guarantee. One made-up claim ("waterproof", "hypoallergenic", "lifetime warranty") on a live product page can mean returns, chargebacks or legal trouble for the merchant. An automatic check that flags anything unsupported is the strongest trust feature the app could have, and it makes the "never invents facts" promise something merchants can verify.

## What to build

- After each draft is written, a second, cheaper AI pass compares the draft against the product facts and returns a list of **claims**, each marked as one of:
  - `supported`: backed by a fact, quoting it.
  - `unsupported`: not in the facts.
  - `risky`: health, safety, legal, environmental or guarantee claims, even when supported.
- The review screen highlights unsupported and risky phrases in the draft with a tooltip explaining each one.
- A **"Remove flagged claims"** button regenerates the draft with those claims banned (reusing plan 03's refine path).
- A local check for the brand voice's **avoid words**, done with plain string matching, no AI needed.
- A setting: "Block apply while there are unsupported claims" (off by default, with a warning instead).

## Implementation

1. **AI (`app/lib/factcheck.server.ts`).** `checkClaims(facts, draft)`, using Haiku 4.5 (`claude-haiku-4-5-20251001`) with a Zod schema:
   ```ts
   z.object({ claims: z.array(z.object({
     text: z.string().describe("The exact phrase from the draft"),
     verdict: z.enum(["supported", "unsupported", "risky"]),
     evidence: z.string().describe("The fact that supports it, or why it is flagged"),
   })) })
   ```
   The facts must be the same object the draft was written from. Reuse the `productFacts()` function from plan 12, or move it out of `buildPrompt` now.
2. **When it runs.** Inside `createDraft`, straight after `generateCopy`. Store the result as `claims String @default("[]")` on `Generation`. In bulk runs it simply adds one cheap call per product.
3. **Avoid words.** `findAvoidedWords(html, voice.avoidWords)` in `app/lib/copy.ts` does case-insensitive whole-word matching and shows its matches in the same list of flags.
4. **Highlighting.** In the review panel, wrap each claim's `text` in `<mark>` in the preview only (never in the saved HTML). Match on plain text so tags in between don't break the match.
5. **History and health.** Show a small "2 flagged" badge on drafts in the History list and the review queue (plan 01).
6. **Demo mode.** Return an empty claims list, or one fixed example flag so the UI can be shown.

## Edge cases

- The checker itself can be wrong. Present flags as "worth checking", not as errors, and let the merchant dismiss each one (`dismissed: true` stored on the claim).
- The merchant edits the draft before applying. Re-run the local avoid-words check while they type. Re-run the AI check only when they click "Check again".
- Claims that come from a refine note ("it's waterproof", see plan 03) count as supported. Pass the note in as a fact.

## Done when

- [ ] A draft that adds "machine washable" when no fact says so gets that phrase highlighted as unsupported.
- [ ] "Remove flagged claims" produces a draft without it.
- [ ] Avoid-word matches are highlighted instantly while editing.
- [ ] The check adds well under a cent per draft (check `usage` from the response).
