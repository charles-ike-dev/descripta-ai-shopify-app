/**
 * Pure helpers for background jobs, kept free of database and Shopify imports
 * so they can be unit tested and shared with the browser.
 */

/** Most products one bulk run may draft (one page of the product scan). */
export const MAX_BULK = 250;
/** Tries per item before it is marked failed. */
export const MAX_ATTEMPTS = 3;

/** How the products page sees an item. The worker's "running" is "writing". */
export type BulkItemStatus =
  "queued" | "writing" | "done" | "failed" | "cancelled";

export interface BulkItem {
  id: string; // numeric product id
  title: string;
  status: BulkItemStatus;
  error?: string;
}

export interface BulkJob {
  id: string;
  items: BulkItem[];
  running: boolean;
  cancelling: boolean;
}

/** The job as the products page shows it. */
export function toBulkJob(
  job: { id: string; status: string; finishedAt: Date | string | null },
  items: {
    resourceId: string;
    title: string;
    status: string;
    error: string | null;
  }[],
): BulkJob {
  const running = job.finishedAt === null;
  return {
    id: job.id,
    running,
    cancelling: running && job.status === "cancelled",
    items: items.map((item) => ({
      id: item.resourceId.split("/").pop() || item.resourceId,
      title: item.title,
      status: (item.status === "running"
        ? "writing"
        : item.status) as BulkItemStatus,
      ...(item.error ? { error: item.error } : {}),
    })),
  };
}

const NETWORK_ERRORS = new Set([
  // Anthropic SDK
  "APIConnectionError",
  "APIConnectionTimeoutError",
  // Shopify API library
  "HttpRequestError",
  "HttpMaxRetriesError",
]);

/** The HTTP status an error carries, from either SDK or a thrown Response. */
function statusOf(error: object): number | undefined {
  const e = error as {
    status?: unknown;
    response?: { code?: unknown; status?: unknown };
  };
  const status = e.status ?? e.response?.code ?? e.response?.status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Whether trying again later might work: rate limits, overloads, server
 * errors and dropped connections, from Anthropic or Shopify. Anything else
 * (a deleted product, a refusal, a bad request) fails straight away.
 */
export function retryable(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const name = (error as { name?: unknown }).name;
  if (typeof name === "string" && NETWORK_ERRORS.has(name)) return true;
  // Shopify answers a throttled GraphQL query with 200 and a THROTTLED error.
  if (error instanceof Error && /throttled/i.test(error.message)) return true;
  const status = statusOf(error);
  return status === 408 || status === 429 || (status ?? 0) >= 500;
}

/**
 * How long an item waits before its next try: about 15 seconds, then about a
 * minute. The jitter spreads out items that hit a rate limit together.
 */
export function retryDelayMs(attempt: number, random = Math.random) {
  const base = 15_000 * 4 ** Math.max(0, attempt - 1);
  return Math.round(base * (0.8 + 0.4 * random()));
}

/** A message a merchant can read, for an error from any layer. */
export function errorMessage(error: unknown) {
  if (error && typeof error === "object") {
    if ((error as { name?: unknown }).name === "SessionNotFoundError") {
      return "Descripta is no longer installed on this store";
    }
    // The Shopify library throws a bare Response when a token refresh fails.
    if (!(error instanceof Error) && statusOf(error)) {
      return `Shopify could not be reached (${statusOf(error)})`;
    }
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Which queued items to start, in order, given how many items each shop
 * already has running. Caps each shop so one big run can't take every slot.
 */
export function pickClaimable(
  candidates: { id: string; shop: string }[],
  running: Map<string, number>,
  slots: number,
  perShop: number,
) {
  const counts = new Map(running);
  const picked: string[] = [];
  for (const item of candidates) {
    if (picked.length >= slots) break;
    const count = counts.get(item.shop) ?? 0;
    if (count >= perShop) continue;
    counts.set(item.shop, count + 1);
    picked.push(item.id);
  }
  return picked;
}

/** When a recurring task should next run, skipping any runs it missed. */
export function nextRunAt(due: Date, intervalMinutes: number, now: Date) {
  const step = Math.max(1, intervalMinutes) * 60_000;
  const missed = Math.max(
    0,
    Math.floor((now.getTime() - due.getTime()) / step),
  );
  return new Date(due.getTime() + (missed + 1) * step);
}
