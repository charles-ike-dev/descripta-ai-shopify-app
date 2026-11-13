# 02: Server-side bulk jobs

**Effort:** L · **Depends on:** none · **Unblocks:** 09, the nightly tasks in 11 and 18, and larger runs for 05, 06 and 07

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
     runAfter   DateTime @default(now()) // lets plan 09 delay an item
     lockedBy   String?  // id of the worker that claimed it
     lockedAt   DateTime?
     @@index([status, runAfter])
     @@index([lockedBy])
   }
   ```
   Add both models to `deleteShopData`.
2. **Worker (`app/lib/worker.server.ts`).**
   - **Claiming items.** Prisma's `updateMany` returns only a count, not the rows it changed. Each worker gets a random `workerId` at start-up. Every 2 seconds it:
     1. Selects up to N ids where `status = "queued"` and `runAfter <= now`.
     2. Runs `updateMany` on those ids, with `status = "queued"` repeated in the filter, setting `status = "running"`, `lockedBy = workerId` and `lockedAt = now`.
     3. Reads back the items where `lockedBy = workerId` and `status = "running"`.

     If two instances race, the repeated status filter means only one of them claims each item.
   - **Running an item.** Get an Admin client with `unauthenticated.admin(shop)` from `app/shopify.server.ts`, then call `getProduct` and `createDraft`. The app sets `expiringOfflineAccessTokens: true`, so offline tokens expire. Check that `unauthenticated.admin` refreshes them with the stored `refreshToken`, including for shops that haven't opened the app in weeks. Test this on a dev store by running a job after the access token has expired.
   - **Retries.** Retry 429 and 5xx errors from Anthropic and Shopify with backoff, up to 3 attempts.
   - **Crash recovery.** Reclaim items stuck in `running` with `lockedAt` older than 5 minutes.
   - **Starting the worker.** `react-router-serve` has no start-up hook, and `entry.server.tsx` only runs when a page is requested, so neither works as a boot point. Options:
     - (a) Start the worker as a side effect of importing a server module that loads early. `app/shopify.server.ts` is imported by every authenticated route. Guard it with a `globalThis` flag so Vite HMR doesn't start a second copy in development.
     - (b) Run it as a separate process (`node build/worker.js`) next to the web server, with its own entry in the `Dockerfile`.

     Start with (a). Move to (b) when you run more than one web instance or want to restart the worker on its own.
3. **Scheduled tasks.** Plan 11 needs a nightly catalog rescan and plan 18 needs a nightly metrics pull. Add a small `ScheduledTask` model (`name`, `shop?`, `nextRunAt`, `intervalMinutes`). The worker loop checks it and creates normal `Job`s when a task is due, then moves `nextRunAt` forward. This keeps everything on one worker, with no cron service to run.
4. **Routes.**
   - `POST /app/api/jobs` creates a job from a list of product ids and returns the `jobId`.
   - `GET /app/api/jobs/:id` returns the counts and the item statuses.
   - `POST /app/api/jobs/:id/cancel` marks the remaining queued items as `cancelled`.
5. **Client.** Rewrite `BulkDraftsProvider` to start a job and poll it. Keep the same `BulkJob` shape so the progress UI barely changes. When the app loads, resume polling any job of this shop's that is still running.
6. **Limits.** Raise `MAX_BULK` to 250 (one page of `SCAN_LIMIT`). Keep per-shop concurrency at about 2 to stay inside Anthropic rate limits.

## Optional: Message Batches API

For runs of more than about 50 products, submitting one Anthropic Message Batch costs about 50% less and usually finishes within minutes, though it can take up to 24 hours. The worker would submit the batch, store the batch id on the `Job`, poll it, then write a `Generation` row for each result. It's worth adding once billing (plan 08) makes cost visible. It's not needed for the first version.

The batch API rejects the `fallbacks` setting that `generateCopy` sends, so build batch requests without it. A batch item declined for safety reasons comes back as a refusal. Mark that item as failed, or retry it as a normal request.

## Edge cases

- The shop uninstalls during a job. The uninstall webhook deletes its rows, and the worker must handle a missing session without crashing.
- Deploys and restarts. Queued items survive in the database, and stuck running items are reclaimed.
- SQLite in development has weak concurrent-write behaviour. Keep worker concurrency low, or test on Postgres.

## Done when

- [ ] Starting a 50-product run, closing the browser and coming back 5 minutes later shows it finished.
- [ ] Cancel stops all items that haven't started.
- [ ] Killing the server mid-run, then restarting it, completes the run with no duplicate drafts.
- [ ] Two server instances against the same Postgres database never process the same item twice.
- [ ] A job for a shop whose offline access token has expired still succeeds, because the token is refreshed.
