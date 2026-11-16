/**
 * Pure helpers for applying and undoing drafts, kept free of database and
 * Shopify imports so they can be unit tested.
 */
import { sanitizeHtml } from "./copy";

/** Most drafts one apply request handles, so it finishes in normal time. */
export const MAX_APPLY = 50;
/** Product updates sent to Shopify at the same time. */
export const APPLY_CONCURRENCY = 2;

/** Hard caps on what is saved, a little above what search engines show. */
const SEO_TITLE_MAX = 70;
const SEO_DESCRIPTION_MAX = 320;

export interface CopyFields {
  descriptionHtml: string;
  seoTitle: string;
  seoDescription: string;
}

/** The outcome of applying or undoing one draft. */
export type ApplyResult =
  | { id: string; ok: true }
  | { id: string; ok: false; stale: boolean; error: string };

/**
 * The copy to save for a draft. The merchant may have edited the draft before
 * applying it, so edits win over the stored draft. HTML is always sanitised.
 */
export function copyToApply(
  draft: CopyFields,
  edits: Partial<CopyFields> = {},
): CopyFields {
  return {
    descriptionHtml: sanitizeHtml(
      edits.descriptionHtml ?? draft.descriptionHtml,
    ),
    seoTitle: (edits.seoTitle ?? draft.seoTitle).slice(0, SEO_TITLE_MAX),
    seoDescription: (edits.seoDescription ?? draft.seoDescription).slice(
      0,
      SEO_DESCRIPTION_MAX,
    ),
  };
}

const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? "").trim() === (b ?? "").trim();

/**
 * Whether the product's copy changed since Descripta last saw it. Both sides
 * are values read back from Shopify, so its own HTML formatting never counts
 * as a change.
 */
export function copyChanged(
  current: {
    descriptionHtml: string;
    seoTitle: string | null;
    seoDescription: string | null;
  },
  expected: {
    descriptionHtml: string;
    seoTitle: string | null;
    seoDescription: string | null;
  },
) {
  return (
    !sameText(current.descriptionHtml, expected.descriptionHtml) ||
    !sameText(current.seoTitle, expected.seoTitle) ||
    !sameText(current.seoDescription, expected.seoDescription)
  );
}

/** Runs `fn` over `items` with at most `limit` calls in flight, keeping order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return results;
}

/** Counts for a toast or banner after a batch of applies or undos. */
export function summarize(results: ApplyResult[]) {
  const failures = results.filter(
    (r): r is Extract<ApplyResult, { ok: false }> => !r.ok,
  );
  return {
    done: results.length - failures.length,
    stale: failures.filter((r) => r.stale).map((r) => r.id),
    failed: failures.filter((r) => !r.stale).map((r) => r.id),
  };
}

export const plural = (count: number, one: string, many = `${one}s`) =>
  `${count} ${count === 1 ? one : many}`;
