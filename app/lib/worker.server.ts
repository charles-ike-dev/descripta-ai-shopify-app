/**
 * The background worker. It runs inside the web server process, polls the
 * database for queued job items and carries them out, so a bulk run keeps
 * going after the merchant closes the app.
 *
 * Several workers (one per server instance) can share one database: an item
 * is claimed with a conditional update, so only one of them runs it.
 */
import { hostname } from "node:os";
import { randomUUID } from "node:crypto";
import type { Prisma, ScheduledTask } from "@prisma/client";
import type { AdminApiContext } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import { unauthenticated } from "../shopify.server";
import { draftRecord, writeCopy } from "./drafts.server";
import { finishJobIfIdle } from "./jobs.server";
import {
  MAX_ATTEMPTS,
  errorMessage,
  nextRunAt,
  pickClaimable,
  retryDelayMs,
  retryable,
} from "./jobs";
import { getProduct } from "./products.server";

/** How often the worker looks for work. */
const TICK_MS = 2000;
/** Items one worker runs at the same time, across all shops. */
const MAX_RUNNING = Number(process.env.JOBS_CONCURRENCY) || 4;
/** Items one shop may have running at once, to stay inside API rate limits. */
const PER_SHOP = 2;
/**
 * A running item's lock is refreshed every tick, so a lock this old means its
 * worker died (a crash or a kill) and the item can be run again.
 */
const STALE_AFTER_MS = 5 * 60 * 1000;
/** How often to look for stale items and due tasks. Neither is urgent. */
const HOUSEKEEPING_MS = 30 * 1000;

/**
 * Does the slow part of one item (Shopify reads, the AI call) and returns a
 * function that saves the result inside the transaction that marks the item
 * done. Either both are saved or neither, so an item that is retried after a
 * crash never leaves a duplicate behind. The saver returns the new row's id.
 */
type ItemHandler = (ctx: {
  admin: AdminApiContext;
  shop: string;
  resourceId: string;
}) => Promise<(tx: Prisma.TransactionClient) => Promise<string>>;

const HANDLERS: Record<string, ItemHandler> = {
  draft: async ({ admin, shop, resourceId }) => {
    const product = await getProduct(admin, resourceId);
    if (!product) throw new Error("Product no longer exists");
    const copy = await writeCopy(shop, product);
    return async (tx) => {
      const saved = await tx.generation.create({
        data: draftRecord(shop, product, copy),
        select: { id: true },
      });
      return saved.id;
    };
  },
};

/** Recurring tasks by name. Plans 11 and 18 register theirs here. */
const TASKS = new Map<string, (task: ScheduledTask) => Promise<void>>();

export function registerTask(
  name: string,
  handler: (task: ScheduledTask) => Promise<void>,
) {
  TASKS.set(name, handler);
}

/** Thrown inside the save transaction when this worker no longer owns the item. */
class LostClaim extends Error {}

class Worker {
  readonly id = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  private inFlight = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private ticking: Promise<void> | null = null;
  private wakeUp = false;
  private lastHousekeeping = 0;

  start() {
    console.log(`[worker] started ${this.id}`);
    this.schedule(0);
  }

  /** Stops claiming work and hands running items back to the queue. */
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    // A tick in progress may still claim items, so let it end first.
    await this.ticking;
    // A restarted or other instance can pick these up straight away instead
    // of waiting for the locks to go stale. If one still finishes here, its
    // save finds the lock gone and is rolled back.
    await db.jobItem.updateMany({
      where: { lockedBy: this.id, status: "running" },
      data: {
        status: "queued",
        lockedBy: null,
        lockedAt: null,
        attempts: { decrement: 1 },
      },
    });
  }

  /**
   * Looks for work now instead of at the next tick, when a job was just
   * queued or a slot just freed up.
   */
  wake() {
    if (this.stopped) return;
    if (this.ticking) {
      this.wakeUp = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.schedule(0);
  }

  private schedule(delay: number) {
    if (this.stopped) return;
    this.timer = setTimeout(() => this.tick(), delay);
    // Never keep the process alive just for the worker.
    this.timer.unref();
  }

  private tick() {
    this.ticking = this.work().finally(() => {
      this.ticking = null;
      const again = this.wakeUp;
      this.wakeUp = false;
      this.schedule(again ? 0 : TICK_MS);
    });
  }

  private async work() {
    try {
      await this.heartbeat();
      if (Date.now() - this.lastHousekeeping >= HOUSEKEEPING_MS) {
        this.lastHousekeeping = Date.now();
        await this.reclaimStale();
        await this.runDueTasks();
      }
      await this.claimAndRun();
    } catch (error) {
      console.error("[worker] tick failed", error);
    }
  }

  /** Refreshes the locks on items this worker is running. */
  private async heartbeat() {
    if (this.inFlight.size === 0) return;
    await db.jobItem.updateMany({
      where: { id: { in: [...this.inFlight] }, lockedBy: this.id },
      data: { lockedAt: new Date() },
    });
  }

  /** Puts items whose worker died back in the queue, or fails them if spent. */
  private async reclaimStale() {
    const cutoff = new Date(Date.now() - STALE_AFTER_MS);
    const stale = await db.jobItem.findMany({
      where: { status: "running", lockedAt: { lt: cutoff } },
      select: { id: true, jobId: true, attempts: true },
    });
    for (const item of stale) {
      // Ours are still running. Their locks only look old if the heartbeat
      // failed, and starting them a second time would waste an AI call.
      if (this.inFlight.has(item.id)) continue;
      const spent = item.attempts >= MAX_ATTEMPTS;
      // Conditional, so two workers reclaiming at once do it only once.
      const { count } = await db.jobItem.updateMany({
        where: { id: item.id, status: "running", lockedAt: { lt: cutoff } },
        data: spent
          ? {
              status: "failed",
              error: "Stopped before finishing. Try again.",
              lockedBy: null,
              lockedAt: null,
            }
          : { status: "queued", lockedBy: null, lockedAt: null },
      });
      if (count && spent) await finishJobIfIdle(item.jobId);
    }
  }

  /** Runs recurring tasks that are due and moves them to their next time. */
  private async runDueTasks() {
    const now = new Date();
    const due = await db.scheduledTask.findMany({
      where: { nextRunAt: { lte: now } },
      take: 20,
    });
    for (const task of due) {
      const handler = TASKS.get(task.name);
      if (!handler) continue;
      // Moving nextRunAt only if no one else has, so each run happens once.
      const { count } = await db.scheduledTask.updateMany({
        where: { id: task.id, nextRunAt: task.nextRunAt },
        data: {
          nextRunAt: nextRunAt(task.nextRunAt, task.intervalMinutes, now),
        },
      });
      if (count === 0) continue;
      try {
        await handler(task);
      } catch (error) {
        console.error(`[worker] task ${task.name} failed`, error);
      }
    }
  }

  /** Claims as many queued items as there are free slots and starts them. */
  private async claimAndRun() {
    const slots = MAX_RUNNING - this.inFlight.size;
    if (slots <= 0 || this.stopped) return;

    const now = new Date();
    const due = { status: "queued", runAfter: { lte: now } };
    // Most ticks find nothing to do, so check that with one cheap query.
    if (!(await db.jobItem.findFirst({ where: due, select: { id: true } }))) {
      return;
    }

    const busy = await db.jobItem.groupBy({
      by: ["shop"],
      where: { status: "running" },
      _count: { _all: true },
    });
    const running = new Map(busy.map((b) => [b.shop, b._count._all]));
    const full = busy
      .filter((b) => b._count._all >= PER_SHOP)
      .map((b) => b.shop);

    const take = slots * PER_SHOP;
    const candidates = await db.jobItem.findMany({
      where: { ...due, ...(full.length ? { shop: { notIn: full } } : {}) },
      orderBy: [{ runAfter: "asc" }, { position: "asc" }],
      take,
      select: {
        id: true,
        shop: true,
        jobId: true,
        job: { select: { status: true } },
      },
    });

    // An item of a stopped run can be queued again by a stale lock or a
    // shutdown hand-back. Cancel it here so it never starts.
    const stopped = candidates.filter((c) => c.job.status === "cancelled");
    if (stopped.length) {
      await db.jobItem.updateMany({
        where: { id: { in: stopped.map((c) => c.id) }, status: "queued" },
        data: { status: "cancelled" },
      });
      for (const jobId of new Set(stopped.map((c) => c.jobId))) {
        await finishJobIfIdle(jobId);
      }
    }

    const ids = pickClaimable(
      candidates.filter(
        (c) => c.job.status !== "cancelled" && !this.inFlight.has(c.id),
      ),
      running,
      slots,
      PER_SHOP,
    );
    // A full window that left slots free was taken up by shops at their cap.
    // Look again straight away, with those shops now left out.
    if (candidates.length === take && ids.length < slots) this.wakeUp = true;
    if (ids.length === 0) return;

    // Prisma's updateMany returns only a count, so claim by stamping our id
    // and read back what we got. Repeating status = queued means only one
    // worker wins each item, and a cancelled item is never started.
    await db.jobItem.updateMany({
      where: { id: { in: ids }, status: "queued" },
      data: {
        status: "running",
        lockedBy: this.id,
        lockedAt: now,
        attempts: { increment: 1 },
      },
    });
    const claimed = await db.jobItem.findMany({
      where: { id: { in: ids }, lockedBy: this.id, status: "running" },
      include: { job: { select: { kind: true } } },
    });
    if (claimed.length === 0) return;

    await db.job.updateMany({
      where: {
        id: { in: [...new Set(claimed.map((i) => i.jobId))] },
        status: "queued",
      },
      data: { status: "running" },
    });
    // stop() hands these back once this tick has ended.
    if (this.stopped) return;

    for (const item of claimed) {
      this.inFlight.add(item.id);
      void this.run(item)
        .catch((error) => console.error(`[worker] item ${item.id}`, error))
        .finally(() => {
          this.inFlight.delete(item.id);
          this.wake();
        });
    }
  }

  private async run(item: {
    id: string;
    jobId: string;
    shop: string;
    resourceId: string;
    attempts: number;
    job: { kind: string };
  }) {
    const mine = { id: item.id, lockedBy: this.id, status: "running" };
    try {
      const handler = HANDLERS[item.job.kind];
      if (!handler) throw new Error(`Unknown job kind "${item.job.kind}"`);
      // Refreshes the shop's offline token if it has expired.
      const { admin } = await unauthenticated.admin(item.shop);
      const save = await handler({
        admin,
        shop: item.shop,
        resourceId: item.resourceId,
      });
      await db.$transaction(async (tx) => {
        const resultId = await save(tx);
        const { count } = await tx.jobItem.updateMany({
          where: mine,
          data: {
            status: "done",
            resultId,
            error: null,
            lockedBy: null,
            lockedAt: null,
          },
        });
        // Taken over by another worker, cancelled by an uninstall, or handed
        // back on shutdown: roll the result back so it isn't saved twice.
        if (count === 0) throw new LostClaim();
      });
    } catch (error) {
      if (error instanceof LostClaim) return;
      const unlock = { lockedBy: null, lockedAt: null };
      const retry = item.attempts < MAX_ATTEMPTS && retryable(error);
      if (retry) {
        // Unless the run was stopped meanwhile: then it doesn't start again.
        const { count } = await db.jobItem.updateMany({
          where: { ...mine, job: { status: { not: "cancelled" } } },
          data: {
            status: "queued",
            runAfter: new Date(Date.now() + retryDelayMs(item.attempts)),
            ...unlock,
          },
        });
        if (count) return;
      } else {
        console.error(`[worker] item ${item.id} failed`, error);
      }
      await db.jobItem.updateMany({
        where: mine,
        data: retry
          ? { status: "cancelled", ...unlock }
          : { status: "failed", error: errorMessage(error), ...unlock },
      });
    }
    await finishJobIfIdle(item.jobId);
  }
}

declare global {
  // eslint-disable-next-line no-var
  var descriptaWorker: Worker | undefined;
}

/**
 * Starts the worker once per process. The flag lives on globalThis so Vite's
 * hot reload in development doesn't start a second copy. Set JOBS_WORKER=off
 * on web instances when the worker runs as its own process. Tests never
 * start it.
 */
export function startWorker() {
  if (
    globalThis.descriptaWorker ||
    process.env.JOBS_WORKER === "off" ||
    process.env.VITEST
  ) {
    return;
  }
  const worker = new Worker();
  globalThis.descriptaWorker = worker;
  worker.start();
  // Deploys stop the server with SIGTERM. react-router-serve and Vite each
  // handle it by closing their server, so this only hands items back and
  // leaves exiting to them.
  process.once("SIGTERM", () => {
    void worker.stop().catch((error) => console.error("[worker]", error));
  });
}
