# 15: Duplicate and boilerplate copy detection

**Effort:** M · **Depends on:** 11 (needs the full catalog to compare against)

## Why

Many stores paste the same supplier description into dozens of products, or reuse one template with a single word changed. Search engines treat near-identical pages as duplicate content and rank them lower, and shoppers can't tell the variants apart. The current health score can't see this: a 200-word copied description scores "Great".

## What to build

- A new health issue, **"Duplicate copy (shared with 14 products)"**, which lowers the score.
- A **Duplicates** view grouping products whose descriptions are near-identical, with "Rewrite this group" to start a bulk draft run for the whole group.
- A **duplicate SEO title / meta description** check, which is exact-match and cheap.
- When rewriting a group, tell Claude about the siblings so each draft focuses on what makes its product *different*.

## Implementation

1. **Fingerprints.** For each product, normalise the description (lowercase, strip HTML and punctuation, collapse spaces), split it into 5-word shingles, and compute a **MinHash** signature (about 64 hashes). Store it on `ProductHealth` (plan 11) as `minhash String` (JSON or a packed base64 string). This is pure TypeScript, so no new dependency is needed.
2. **Grouping.** Use locality-sensitive hashing: split each signature into 16 bands of 4. Products that share any band bucket are candidates. Confirm candidates with an estimated Jaccard similarity ≥ 0.8. Union-find gives the groups. This runs at the end of each catalog scan, in roughly linear time.
3. **Schema.** Add `dupGroup String?` and `dupCount Int @default(0)` to `ProductHealth`.
4. **Exact SEO duplicates.** `GROUP BY seoTitle` and `GROUP BY seoDescription` over `ProductHealth`, flagging groups with more than one product.
5. **Health score.** Add an optional `duplicateOf?: number` to `HealthInput` in `app/lib/health.ts`. If it's above 0, cap the description points at 20 and add the issue text.
6. **Rewrite prompt.** Add `siblings?: string[]` (sibling product titles) to `ProductInput`. In `buildPrompt`: "These products currently share the same description: … Write copy that makes clear what is specific to *this* product. Don't reuse sentences from the shared description."
7. **UI.** Add a "Duplicates" filter on the products page, plus a group view showing the shared text once and the product list beside it.

## Edge cases

- Very short descriptions (under 15 words) produce noisy matches, so skip them. They're already flagged as thin.
- Shared boilerplate *paragraphs* (a shipping blurb at the end of every product) are legitimate. Compute the similarity with any paragraph that appears in more than 30% of products removed first, and report those paragraphs separately as "Shared footer".
- True variants that are separate products (the same shirt in 5 colours). They're still duplicates for SEO purposes, but the suggestion should mention combining them as variants.

## Done when

- [ ] 20 products sharing one supplier description appear as one group of 20.
- [ ] A shared shipping footer paragraph doesn't make every product a duplicate.
- [ ] After rewriting the group, the products no longer group together on the next scan.
