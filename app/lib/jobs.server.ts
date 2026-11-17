import db from "../db.server";
import { toBulkJob } from "./jobs";

/** Unfinished items. Once none are left, the job is finished. */
const OPEN = { in: ["queued", "running"] };

/** How long a finished run stays on the products page if never dismissed. */
const SHOW_FOR_MS = 7 * 24 * 60 * 60 * 1000;

/** Queues one item per product. The worker picks them up within seconds. */
export async function createJob(
  shop: string,
  kind: string,
  resources: { id: string; title: string }[],
) {
  const job = await db.job.create({
    data: {
      shop,
      kind,
      total: resources.length,
      items: {
        create: resources.map((r, position) => ({
          shop,
          position,
          resourceId: r.id,
          title: r.title,
        })),
      },
    },
    select: { id: true },
  });
  // Start now if this process runs a worker, rather than at its next tick.
  globalThis.descriptaWorker?.wake();
  return job;
}

/** A shop's job with every item, in the order the merchant chose. */
export async function getBulkJob(shop: string, jobId: string) {
  const job = await db.job.findFirst({
    where: { id: jobId, shop },
    include: { items: { orderBy: { position: "asc" } } },
  });
  return job && toBulkJob(job, job.items);
}

/**
 * The run the products page should show: the newest one the merchant hasn't
 * dismissed, whether it is still going or finished while they were away.
 */
export async function currentJobId(shop: string) {
  const job = await db.job.findFirst({
    where: {
      shop,
      kind: "draft",
      dismissedAt: null,
      createdAt: { gte: new Date(Date.now() - SHOW_FOR_MS) },
    },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return job?.id ?? null;
}

/** A shop's run of this kind that hasn't finished yet, if any. */
export async function unfinishedJobId(shop: string, kind: string) {
  const job = await db.job.findFirst({
    where: { shop, kind, finishedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  return job?.id ?? null;
}

/** Marks a job finished once none of its items are waiting or running. */
export async function finishJobIfIdle(jobId: string) {
  const open = await db.jobItem.count({ where: { jobId, status: OPEN } });
  if (open > 0) return;
  const finishedAt = new Date();
  await db.job.updateMany({
    where: { id: jobId, finishedAt: null, status: { not: "cancelled" } },
    data: { status: "done", finishedAt },
  });
  await db.job.updateMany({
    where: { id: jobId, finishedAt: null },
    data: { finishedAt },
  });
}

/**
 * Stops a job: items that haven't started are cancelled, and items already
 * running finish. Returns false if the shop has no such job.
 */
export async function cancelJob(shop: string, jobId: string) {
  const job = await db.job.findFirst({
    where: { id: jobId, shop },
    select: { id: true },
  });
  if (!job) return false;
  // The worker claims only items that are still queued, so an item is either
  // cancelled here or started there, never both.
  await db.$transaction([
    db.jobItem.updateMany({
      where: { jobId, status: "queued" },
      data: { status: "cancelled" },
    }),
    db.job.updateMany({
      where: { id: jobId, finishedAt: null },
      data: { status: "cancelled" },
    }),
  ]);
  await finishJobIfIdle(jobId);
  return true;
}

/**
 * Hides a finished job's progress banner. A running job can't be dismissed,
 * or it would carry on with no way to see or stop it.
 */
export async function dismissJob(shop: string, jobId: string) {
  const { count } = await db.job.updateMany({
    where: { id: jobId, shop, dismissedAt: null, finishedAt: { not: null } },
    data: { dismissedAt: new Date() },
  });
  return count > 0;
}

/**
 * Makes sure a recurring task exists, first due at `firstRunAt`. Calling it
 * again keeps the existing schedule but updates the interval.
 */
export async function scheduleTask(
  name: string,
  opts: { shop?: string; intervalMinutes: number; firstRunAt?: Date },
) {
  const shop = opts.shop ?? null;
  const existing = await db.scheduledTask.findFirst({ where: { name, shop } });
  if (existing) {
    return db.scheduledTask.update({
      where: { id: existing.id },
      data: { intervalMinutes: opts.intervalMinutes },
    });
  }
  return db.scheduledTask.create({
    data: {
      name,
      shop,
      intervalMinutes: opts.intervalMinutes,
      nextRunAt: opts.firstRunAt ?? new Date(),
    },
  });
}
