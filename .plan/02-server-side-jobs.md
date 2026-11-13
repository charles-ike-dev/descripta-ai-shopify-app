# 02: Server-side bulk jobs

**Effort:** L · **Depends on:** none · **Unblocks:** 09, and larger runs for 05, 06 and 07

## Why

Bulk drafting runs in the browser. `BulkDraftsProvider` (`app/lib/bulk.tsx`) loops over the selected products and calls `/app/api/drafts` once per product, two at a time. As a result:

- Closing the tab or the Shopify admin stops the run.
- Runs are capped at `MAX_BULK = 25`.
- The server can't start work on its own, so the auto-draft webhook in plan 09 can't be built yet.

## What to build

A database-backed job queue with a worker in the same process. The browser starts a job and polls for progress, so it no longer runs the job itself.

## Implementation

1. **Schema.**
   ```prisma
   model Job {
     id        String    @id @default(cuid())
     shop      String
     kind      String    // "draft" (later: "alt_text", "collection", "translate")
     status    String    @default("queued") // queued | running | done | cancelled
     total     Int
     createdAt DateTime  @default(now())
     finishedAt DateTime?
     items     JobItem[]
     @@index([shop, status])
   }
   model JobItem {
     id         String  @id @default(cuid())
     jobId      String
     job        Job     @relation(fields: [jobId], references: [id], onDelete: Cascade)
     resourceId String  // product GID
     title      String
     status     String  @default("queued") // queued | running | done | failed | cancelled
     error      String?
     resultId   String? // Generation id
     attempts   Int     @default(0)
     lockedAt   DateTime?
     @@index([status, lockedAt])
   }
   ```
   Add both models to `deleteShopData`.
2. **Worker (`app/lib/worker.server.ts`).**
   - Every 2 seconds, claim up to N queued items. Claim them with an `updateMany` filtered on `status = "queued"` that sets `status = "running"` and `lockedAt = now`, so two server instances can't take the same item.
   - For each item, get an Admin client with `unauthenticated.admin(shop)` from `app/shopify.server.ts` (this uses the offline token), then call `getProduct` and `createDraft`.
   - Retry 429 and 5xx errors from Anthropic and Shopify with backoff, up to 3 attempts.
   - Reclaim items that have been stuck in `running` with `lockedAt` older than 5 minutes, which happens after a crash.
   - Start it once at boot. Guard it with a module-level flag so Vite HMR doesn't start a second copy in development.
3. **Routes.**
   - `POST /app/api/jobs` creates a job from a list of product ids and returns the `jobId`.
   - `GET /app/api/jobs/:id` returns the counts and the item statuses.
   - `POST /app/api/jobs/:id/cancel` marks the remaining queued items as `cancelled`.
4. **Client.** Rewrite `BulkDraftsProvider` to start a job and poll it. Keep the same `BulkJob` shape so the progress UI barely changes. When the app loads, resume polling any job of this shop's that is still running.
5. **Limits.** Raise `MAX_BULK` to 250 (one page of `SCAN_LIMIT`). Keep per-shop concurrency at about 2 to stay inside Anthropic rate limits.

## Optional: Message Batches API

For runs of more than about 50 products, submitting one Anthropic Message Batch costs about 50% less and usually finishes within minutes, though it can take up to 24 hours. The worker would submit the batch, store the batch id on the `Job`, poll it, then write a `Generation` row for each result. It's worth adding once billing (plan 08) makes cost visible. It's not needed for the first version.

## Edge cases

- The shop uninstalls during a job. The uninstall webhook deletes its rows, and the worker must handle a missing session without crashing.
- Deploys and restarts. Queued items survive in the database, and stuck running items are reclaimed.
- SQLite in development has weak concurrent-write behaviour. Keep worker concurrency low, or test on Postgres.

## Done when

- [ ] Starting a 50-product run, closing the browser and coming back 5 minutes later shows it finished.
- [ ] Cancel stops all items that haven't started.
- [ ] Killing the server mid-run, then restarting it, completes the run with no duplicate drafts.
